/**
 * Questionnaire — internal business logic (Standard §2 `logic.ts`). A THIN CRUD
 * surface over `candidate_answers`: list this org's answer rows, and save one
 * answer. No stage logic, no derivation — the answers table is flat.
 *
 * SCOPED BY `org_id`, AND ONLY BY `org_id`. The `org_id` filter in `queryList` is a
 * CONTEXT filter ("this org's rows"), NOT security. Security lives in the DATABASE:
 * candidate_answers' RLS (auth_user_can_read / auth_user_can_write, 20260727000001)
 * gates every read and write on org-tree membership. The logic touches the data
 * ONLY through the provided `CortexDb` — which routes candidate_answers to the RLS
 * client (never service_role; see supabase-db.ts) — so every call carries the
 * caller's JWT and RLS is the enforcement point.
 *
 * The rows are materialised elsewhere (the invite sequence, in the candidate's
 * child org). This tool NEVER inserts or deletes them — it lists and answers,
 * nothing more. `answer` is the only write, and it patches a single column.
 *
 * DB ↔ JS NAMING: snake_case columns (`question_key`, `question_text`) map to
 * camelCase here; `toRow` is the single place that mapping lives.
 */
import { type Ctx, type CortexDb, type DbRow } from "@platform/cortex-core";

export const QUESTIONNAIRE_TABLE = "candidate_answers";

/** One questionnaire row as returned to the AI/views. `questionText` is the
 * frozen snapshot of the question as asked; `answer` is '' until answered. */
export interface QuestionnaireRow {
  id: string;
  questionKey: string;
  questionText: string;
  answer: string;
  position: number;
}

/** query_list takes no input — the org comes from ctx, not the caller. */
export interface QueryListInput {}
export interface AnswerInput {
  id: string;
  answer: string;
}

export interface QuestionnaireLogic {
  queryList(input: QueryListInput, ctx: Ctx): Promise<QuestionnaireRow[]>;
  answer(input: AnswerInput, ctx: Ctx): Promise<QuestionnaireRow>;
}

/** The event-bus surface the logic needs (from `@platform/cortex-core`). */
type Emit = (type: string, payload: unknown, ctx: Ctx) => Promise<void>;

/** Map a raw DB row to a typed questionnaire row. `answer`/`question_text` are
 * NOT NULL on the table (answer defaults ''), so they are never null — but coerce
 * defensively; `position` is numeric. */
function toRow(row: DbRow): QuestionnaireRow {
  return {
    id: String(row.id),
    questionKey: String(row.question_key),
    questionText: String(row.question_text),
    answer: row.answer == null ? "" : String(row.answer),
    position: Number(row.position),
  };
}

export function createQuestionnaireLogic({
  db,
  emit: _emit,
}: {
  db: CortexDb;
  emit: Emit;
}): QuestionnaireLogic {
  return {
    async queryList(_input, ctx) {
      // CONTEXT filter, NOT security (see the header). RLS already refuses every
      // other org's rows; this just narrows to the active org's questionnaire.
      const rows = await db.select(QUESTIONNAIRE_TABLE, { org_id: ctx.orgId });
      // Questionnaire order is the authored `position` (ascending) — a plain
      // numeric sort, no dependency on the adapter's tiny select surface.
      const ordered = [...rows].sort((a, b) => Number(a.position) - Number(b.position));
      return ordered.map(toRow);
    },

    async answer(input, _ctx) {
      // The ONLY write: patch a single row's `answer`. RLS gates it ROW BY ROW
      // (auth_user_can_write behind the UPDATE policy); the where is by id alone —
      // org scope is enforced by RLS, not this filter. Returns the UPDATED row.
      const updated = await db.update(
        QUESTIONNAIRE_TABLE,
        { id: input.id },
        { answer: input.answer, updated_at: new Date().toISOString() },
      );
      // Zero rows back means RLS refused (or the id is not this caller's) — a real
      // failure, not a silent no-op. Throw so the data-layer maps it to a stable code.
      const row = updated[0];
      if (!row) throw new Error("questionnaire: answer not found or not permitted");
      return toRow(row);
    },
  };
}
