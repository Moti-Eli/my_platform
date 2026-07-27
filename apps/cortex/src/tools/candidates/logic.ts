/**
 * Candidates — internal business logic + event emission (Standard §2 `logic.ts`).
 *
 * Cloned from Notes' logic. This is the ONLY place candidates touches its data
 * (through the provided `CortexDb` client — never raw SQL) and the ONLY place it
 * would emit events (through the provided event-bus `emit`). It receives `ctx`
 * from the shell and never fetches identity itself.
 *
 * SCOPED BY `org_id`, AND ONLY BY `org_id`. The `candidates` table (20260722000001)
 * mirrors notes' security model exactly: `owner_id NOT NULL`, `org_id NOT NULL`,
 * `visibility` defaulting to 'org', RLS gating every read and write on org-tree
 * membership. The `org_id` filter below is a CONTEXT filter, not a security one —
 * RLS is the enforcement point (see the note in queryList).
 *
 * The writes below do NOT set `visibility` (defaults to 'org'), exactly as notes'
 * createNote leaves visibility to the DB. `stage`, by contrast, is now DERIVED on
 * EVERY write (create + update) from field completeness via {@link deriveStage} —
 * it is never client-supplied. The manual `set_stage` pathway remains ONLY for
 * archive/restore (the two transitions deriveStage never makes); a future cleanup
 * MAY narrow set_stage to just those two, but this change does not touch it.
 */
import { safeRandomUUID, type Ctx, type CortexDb, type DbRow } from "@platform/cortex-core";

export const CANDIDATES_TABLE = "candidates";
/** The candidate's questionnaire answers (20260727000001) live in their CHILD ORG,
 * owned by their linked user. `candidates.answers` reads this table by owner_id, and
 * the recruiter's DOWNWARD-TREE RLS is the authorization. */
export const CANDIDATE_ANSWERS_TABLE = "candidate_answers";

/** Pipeline stages, in board order. Mirrors the table's CHECK constraint. */
export const CANDIDATE_STAGES = ["contact", "interview", "intake", "archived"] as const;
export type CandidateStage = (typeof CANDIDATE_STAGES)[number];

export interface Candidate {
  id: string;
  name: string;
  role: string;
  stage: CandidateStage;
  summary: string;
  tags: string[];
  urgent: boolean;
  rejectReason: string;
  // Card fields (20260723000002) — same conventions: text '' when unset, booleans strict.
  hasCertificate: boolean;
  phone: string;
  city: string;
  email: string;
  impression: string;
  availability: string;
  hasCar: boolean;
  salaryExpectation: string;
  // Per-stage notes (20260723000006) — same conventions: text '' when unset. These
  // REPLACE the interim shared-`impression` binding. `acceptanceNote` is also the
  // completeness signal deriveStage reads to move a candidate from 'interview' →
  // 'intake' (see deriveStage).
  acceptanceNote: string;
  intakeNote: string;
  // The linked candidate USER account (20260723000007), or null until the
  // candidate is invited to log in. Read-only here — set only by the invite
  // sequence, never by create/update — so it is absent from every write path and
  // from CandidatePatch. The card reads it only to choose the invite button's
  // label (invite vs. re-send link).
  candidateUserId: string | null;
}

/** query_list takes no input — the org comes from ctx, not the caller. */
export interface QueryListInput {}
export interface CreateCandidateInput {
  name: string;
  role?: string;
  summary?: string;
  tags?: string[];
  hasCertificate?: boolean;
  phone?: string;
  city?: string;
  email?: string;
  impression?: string;
  availability?: string;
  hasCar?: boolean;
  salaryExpectation?: string;
  acceptanceNote?: string;
  intakeNote?: string;
}
export interface UpdateCandidateInput {
  id: string;
  name?: string;
  role?: string;
  summary?: string;
  tags?: string[];
  urgent?: boolean;
  hasCertificate?: boolean;
  phone?: string;
  city?: string;
  email?: string;
  impression?: string;
  availability?: string;
  hasCar?: boolean;
  salaryExpectation?: string;
  acceptanceNote?: string;
  intakeNote?: string;
}
export interface SetStageInput {
  id: string;
  stage: CandidateStage;
  rejectReason?: string;
}
export interface DeleteCandidateInput {
  id: string;
}
/** invite takes only the candidate RECORD id; the active org comes from ctx. */
export interface InviteCandidateInput {
  candidateId: string;
}
/** answers takes the candidate RECORD id; it resolves the linked user itself. */
export interface AnswersInput {
  candidateId: string;
}
/** One questionnaire answer as shown, read-only, in the recruiter's card. */
export interface QuestionnaireAnswer {
  questionKey: string;
  questionText: string;
  answer: string;
  position: number;
}
/** `available` = the candidate is LINKED (has a portal), NOT whether the caller may
 * read the rows: a non-privileged caller sees available:true with an empty list, and
 * that is correct — RLS, not this flag, decides visibility. */
export interface AnswersResult {
  answers: QuestionnaireAnswer[];
  available: boolean;
}

export interface CandidatesLogic {
  queryList(input: QueryListInput, ctx: Ctx): Promise<Candidate[]>;
  createCandidate(input: CreateCandidateInput, ctx: Ctx): Promise<{ id: string }>;
  updateCandidate(input: UpdateCandidateInput, ctx: Ctx): Promise<{ id: string }>;
  setStage(input: SetStageInput, ctx: Ctx): Promise<{ id: string }>;
  deleteCandidate(input: DeleteCandidateInput, ctx: Ctx): Promise<{ id: string }>;
  /** Provision (or re-issue a link for) a candidate's login portal. SERVER-SIDE
   *  ONLY — the implementation is INJECTED (createCandidatesInvite on the server; a
   *  throwing stub on the client), because it needs the service client + node crypto
   *  that must not reach the client bundle. Same shape as staff.add_member. */
  invite(input: InviteCandidateInput, ctx: Ctx): Promise<{ link: string }>;
  /** Read a candidate's questionnaire answers for the recruiter's card. Returns
   *  available:false (empty) until the candidate is linked; the answer rows are
   *  authorized by RLS (the recruiter's downward-tree read), so zero rows for a
   *  non-privileged caller is correct and never an error. */
  answers(input: AnswersInput, ctx: Ctx): Promise<AnswersResult>;
}

/** The event-bus surface the logic needs (from `@platform/cortex-core`). */
type Emit = (type: string, payload: unknown, ctx: Ctx) => Promise<void>;

/** Map a raw DB row to a typed candidate (the DB uses snake_case columns —
 * `reject_reason` → `rejectReason`). The text columns default to '' and `tags`
 * to '{}' on the table, so they are never null — but coerce defensively, exactly
 * like notes' toNote: tags is always an array, urgent always a boolean, text
 * fields '' when null, and an out-of-vocabulary stage falls back to 'contact'. */
function toCandidate(row: DbRow): Candidate {
  const stage = (CANDIDATE_STAGES as readonly string[]).includes(String(row.stage))
    ? (String(row.stage) as CandidateStage)
    : "contact";
  return {
    id: String(row.id),
    name: String(row.name),
    role: row.role == null ? "" : String(row.role),
    stage,
    summary: row.summary == null ? "" : String(row.summary),
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    urgent: row.urgent === true,
    rejectReason: row.reject_reason == null ? "" : String(row.reject_reason),
    hasCertificate: row.has_certificate === true,
    phone: row.phone == null ? "" : String(row.phone),
    city: row.city == null ? "" : String(row.city),
    email: row.email == null ? "" : String(row.email),
    impression: row.impression == null ? "" : String(row.impression),
    availability: row.availability == null ? "" : String(row.availability),
    hasCar: row.has_car === true,
    salaryExpectation: row.salary_expectation == null ? "" : String(row.salary_expectation),
    acceptanceNote: row.acceptance_note == null ? "" : String(row.acceptance_note),
    intakeNote: row.intake_note == null ? "" : String(row.intake_note),
    // null until invited — the column is nullable and stays null for almost every
    // row (written only by the invite sequence).
    candidateUserId: row.candidate_user_id == null ? null : String(row.candidate_user_id),
  };
}

/** DERIVED STAGE — computed on every create/update from the row's RESULTING field
 * completeness, mirroring the card UI's client-side derivation EXACTLY:
 *   - name, role, email, phone all non-empty AND acceptanceNote non-empty → 'intake'
 *   - name, role, email, phone all non-empty                              → 'interview'
 *   - otherwise                                                           → 'contact'
 * A field counts as filled when it is non-empty after trimming (same as the UI).
 * Stage is therefore DERIVED, never client-supplied. NOTE: 'archived' is NOT in
 * this function's range and is never produced by it — archive/restore stay on the
 * manual `set_stage` pathway, and callers MUST NOT run deriveStage on a row whose
 * current stage is 'archived' (updateCandidate guards exactly that). */
function deriveStage(fields: {
  name: string;
  role: string;
  email: string;
  phone: string;
  acceptanceNote: string;
}): "contact" | "interview" | "intake" {
  const filled = (s: string) => s.trim() !== "";
  const contactComplete =
    filled(fields.name) && filled(fields.role) && filled(fields.email) && filled(fields.phone);
  if (contactComplete && filled(fields.acceptanceNote)) return "intake";
  if (contactComplete) return "interview";
  return "contact";
}

export function createCandidatesLogic({
  db,
  emit: _emit,
  invite,
}: {
  db: CortexDb;
  emit: Emit;
  /** INJECTED — see CandidatesLogic.invite. The server passes the real
   *  implementation; the client passes a throwing stub (invite never runs client-side). */
  invite: (input: InviteCandidateInput, ctx: Ctx) => Promise<{ link: string }>;
}): CandidatesLogic {
  return {
    invite,
    async queryList(_input, ctx) {
      // A CONTEXT filter — "show me THIS org's candidates" — NOT a security filter.
      // Security lives in the DATABASE: `private.auth_user_can_read` behind the
      // candidates RLS policy, which ANDs org-tree membership before anything else.
      // Delete this filter and nothing becomes insecure — RLS would still refuse
      // every other org's rows; the user would simply see every org they belong to
      // at once, mixed together, which is a UX bug, not a leak.
      const rows = await db.select(CANDIDATES_TABLE, { org_id: ctx.orgId });
      // Order by created_at. ISO timestamptz strings sort lexicographically in
      // chronological order, so a plain string compare is the ordering — no
      // dependency on the adapter's (deliberately tiny) select surface.
      const ordered = [...rows].sort((a, b) =>
        String(a.created_at).localeCompare(String(b.created_at)),
      );
      return ordered.map(toCandidate);
    },

    async createCandidate(input, ctx) {
      const id = safeRandomUUID();
      const now = new Date().toISOString();
      // DERIVE the initial stage from the create's resulting values. A new candidate
      // is never archived, so derive normally (no archived guard needed here).
      const stage = deriveStage({
        name: input.name,
        role: input.role ?? "",
        email: input.email ?? "",
        phone: input.phone ?? "",
        acceptanceNote: input.acceptanceNote ?? "",
      });
      await db.insert(CANDIDATES_TABLE, {
        id,
        // The mandatory fields (§6). Both are NOT NULL on the table. `visibility` is
        // deliberately omitted — the column defaults to 'org'; so are `urgent` /
        // `reject_reason` (default false / ''). `stage` is DERIVED above, not left
        // to the DB default, so a born-complete candidate lands past 'contact'.
        owner_id: ctx.userId,
        org_id: ctx.orgId,
        // tool columns
        name: input.name,
        role: input.role ?? "",
        stage,
        summary: input.summary ?? "",
        tags: input.tags ?? [],
        // card columns (20260723000002) — camelCase input → snake_case columns
        has_certificate: input.hasCertificate ?? false,
        phone: input.phone ?? "",
        city: input.city ?? "",
        email: input.email ?? "",
        impression: input.impression ?? "",
        availability: input.availability ?? "",
        has_car: input.hasCar ?? false,
        salary_expectation: input.salaryExpectation ?? "",
        // per-stage notes (20260723000006)
        acceptance_note: input.acceptanceNote ?? "",
        intake_note: input.intakeNote ?? "",
        created_at: now,
        updated_at: now,
      });
      return { id };
    },

    async updateCandidate(input, _ctx) {
      // RLS gates the update ROW BY ROW (auth_user_can_write behind the UPDATE
      // policy): a member may edit only rows they may write. The where is by id
      // alone — org scope is enforced by RLS, not this filter.
      //
      // Only the fields the caller actually sent are patched: each field is
      // optional, so an edit of one leaves the others untouched. `stage` is the one
      // exception — it is DERIVED below (never accepted from the caller), except for
      // archive/restore which stay on the setStage pathway.
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (input.name !== undefined) patch.name = input.name;
      if (input.role !== undefined) patch.role = input.role;
      if (input.summary !== undefined) patch.summary = input.summary;
      if (input.tags !== undefined) patch.tags = input.tags;
      if (input.urgent !== undefined) patch.urgent = input.urgent;
      if (input.hasCertificate !== undefined) patch.has_certificate = input.hasCertificate;
      if (input.phone !== undefined) patch.phone = input.phone;
      if (input.city !== undefined) patch.city = input.city;
      if (input.email !== undefined) patch.email = input.email;
      if (input.impression !== undefined) patch.impression = input.impression;
      if (input.availability !== undefined) patch.availability = input.availability;
      if (input.hasCar !== undefined) patch.has_car = input.hasCar;
      if (input.salaryExpectation !== undefined)
        patch.salary_expectation = input.salaryExpectation;
      if (input.acceptanceNote !== undefined) patch.acceptance_note = input.acceptanceNote;
      if (input.intakeNote !== undefined) patch.intake_note = input.intakeNote;

      // DERIVE STAGE. Read the existing row FIRST — for two reasons: (1) to learn its
      // current stage, and (2) to fill in the completeness fields the caller did NOT
      // send, so derivation runs over the row's RESULTING values, not a partial patch.
      // CRITICAL — never clobber archived: if the row is currently 'archived', leave
      // `stage` untouched (a candidate stays archived until set_stage restores it).
      // Otherwise overwrite `stage` with the derived value. (If the row is unreadable
      // — RLS/absent — we skip derivation and let the update itself answer via RLS.)
      const existingRows = await db.select(CANDIDATES_TABLE, { id: input.id });
      const existing = existingRows[0] ? toCandidate(existingRows[0]) : null;
      if (existing && existing.stage !== "archived") {
        patch.stage = deriveStage({
          name: input.name ?? existing.name,
          role: input.role ?? existing.role,
          email: input.email ?? existing.email,
          phone: input.phone ?? existing.phone,
          acceptanceNote: input.acceptanceNote ?? existing.acceptanceNote,
        });
      }

      await db.update(CANDIDATES_TABLE, { id: input.id }, patch);
      return { id: input.id };
    },

    async setStage(input, _ctx) {
      // Same RLS story as updateCandidate — the where is by id alone. Writes the
      // stage, and ONLY when archiving also writes reject_reason (defaulting to ''
      // so a reason-less archive clears any stale reason). Moving OUT of archived
      // leaves reject_reason intact — history, not state.
      //
      // STAGE IS NOW DERIVED on create/update (see deriveStage), so this manual
      // pathway is left ONLY for archive/restore — the two transitions deriveStage
      // never makes. It still accepts any stage in the vocabulary (unchanged this
      // prompt); a future cleanup MAY narrow it to just 'archived' ↔ restore.
      const patch: Record<string, unknown> = {
        stage: input.stage,
        updated_at: new Date().toISOString(),
      };
      if (input.stage === "archived") patch.reject_reason = input.rejectReason ?? "";
      await db.update(CANDIDATES_TABLE, { id: input.id }, patch);
      return { id: input.id };
    },

    async deleteCandidate(input, _ctx) {
      // RLS gates the delete ROW BY ROW (auth_user_can_write behind the DELETE
      // policy): a member may delete only rows they may write. The where is by id
      // alone — org scope is enforced by RLS, not this filter, exactly like update.
      await db.delete(CANDIDATES_TABLE, { id: input.id });
      return { id: input.id };
    },

    async answers(input, _ctx) {
      // 1) Read the candidate row (RLS-scoped). Not readable or not yet linked →
      //    nothing to show, and NOT an error: `available` reflects whether a portal
      //    exists, and a caller who can't see the candidate simply gets false.
      const candRows = await db.select(CANDIDATES_TABLE, { id: input.candidateId });
      const candidate = candRows[0] ? toCandidate(candRows[0]) : null;
      const candidateUserId = candidate?.candidateUserId ?? null;
      if (!candidateUserId) return { answers: [], available: false };

      // 2) The answers live in the candidate's CHILD ORG, owned by their user. The
      //    recruiter reads them by DOWNWARD-TREE inheritance — auth_user_can_read is
      //    the authorization. A non-privileged caller sees zero rows here; that is
      //    correct, not an error (db.select returns [] on zero rows, throws only on a
      //    real DB fault). The where is by owner_id; RLS confines what comes back.
      const rows = await db.select(CANDIDATE_ANSWERS_TABLE, { owner_id: candidateUserId });
      const answers = [...rows]
        .sort((a, b) => Number(a.position) - Number(b.position))
        .map((r) => ({
          questionKey: String(r.question_key),
          questionText: String(r.question_text),
          answer: r.answer == null ? "" : String(r.answer),
          position: Number(r.position),
        }));
      return { answers, available: true };
    },
  };
}
