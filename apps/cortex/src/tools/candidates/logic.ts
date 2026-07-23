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
 * The writes below do NOT set `visibility` (defaults to 'org') and create does NOT
 * set `stage` (defaults to 'contact') — the DB defaults are the single source of
 * those initial values, exactly as notes' createNote leaves visibility to the DB.
 */
import { safeRandomUUID, type Ctx, type CortexDb, type DbRow } from "@platform/cortex-core";

export const CANDIDATES_TABLE = "candidates";

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
}
export interface SetStageInput {
  id: string;
  stage: CandidateStage;
  rejectReason?: string;
}
export interface DeleteCandidateInput {
  id: string;
}

export interface CandidatesLogic {
  queryList(input: QueryListInput, ctx: Ctx): Promise<Candidate[]>;
  createCandidate(input: CreateCandidateInput, ctx: Ctx): Promise<{ id: string }>;
  updateCandidate(input: UpdateCandidateInput, ctx: Ctx): Promise<{ id: string }>;
  setStage(input: SetStageInput, ctx: Ctx): Promise<{ id: string }>;
  deleteCandidate(input: DeleteCandidateInput, ctx: Ctx): Promise<{ id: string }>;
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
  };
}

export function createCandidatesLogic({
  db,
  emit: _emit,
}: {
  db: CortexDb;
  emit: Emit;
}): CandidatesLogic {
  return {
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
      await db.insert(CANDIDATES_TABLE, {
        id,
        // The mandatory fields (§6). Both are NOT NULL on the table. `visibility`
        // and `stage` are deliberately omitted — the columns default to 'org' and
        // 'contact'; so are `urgent` / `reject_reason` (default false / '').
        owner_id: ctx.userId,
        org_id: ctx.orgId,
        // tool columns
        name: input.name,
        role: input.role ?? "",
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
      // optional, so an edit of one leaves the others untouched. Stage moves are
      // NOT here — they go through setStage, the one place stage transitions live.
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
      await db.update(CANDIDATES_TABLE, { id: input.id }, patch);
      return { id: input.id };
    },

    async setStage(input, _ctx) {
      // Same RLS story as updateCandidate — the where is by id alone. Writes the
      // stage, and ONLY when archiving also writes reject_reason (defaulting to ''
      // so a reason-less archive clears any stale reason). Moving OUT of archived
      // leaves reject_reason intact — history, not state.
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
  };
}
