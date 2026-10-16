/**
 * Expenses — internal business logic + event emission (Standard §2 `logic.ts`).
 *
 * Cloned from Notes' logic. This is the ONLY place expenses touches its data
 * (through the provided `CortexDb` client — never raw SQL) and the ONLY place it
 * would emit events (through the provided event-bus `emit`). It receives `ctx`
 * from the shell and never fetches identity itself.
 *
 * SCOPED BY `org_id`, AND ONLY BY `org_id`. The `expenses` table (20260717000010)
 * mirrors notes' security model exactly: `owner_id NOT NULL`, `org_id NOT NULL`,
 * `visibility` defaulting to 'org', RLS gating every read and write on org-tree
 * membership. The `org_id` filter below is a CONTEXT filter, not a security one —
 * RLS is the enforcement point (see the note in queryList).
 *
 * The writes below do NOT set `visibility`; the column defaults to 'org', exactly
 * as notes' createNote does. Seeding `visibility` / grants from the manifest is
 * the same clean seam left open there — not this tool's job to invent.
 *
 * DB ↔ JS NAMING: the DB column is snake_case `spent_on`; the tool exposes it as
 * `spentOn`. `toExpense` and the write paths are the single place that mapping lives.
 */
import { safeRandomUUID, type Ctx, type CortexDb, type DbRow } from "@platform/cortex-core";

export const EXPENSES_TABLE = "expenses";

export interface Expense {
  id: string;
  amount: number;
  category: string;
  spentOn: string;
  note: string;
}

/** query_list takes no input — the org comes from ctx, not the caller. */
export interface QueryListInput {}
export interface CreateExpenseInput {
  amount: number;
  category?: string;
  spentOn?: string;
  note?: string;
}
export interface UpdateExpenseInput {
  id: string;
  amount?: number;
  category?: string;
  spentOn?: string;
  note?: string;
}
export interface DeleteExpenseInput {
  id: string;
}

export interface ExpensesLogic {
  queryList(input: QueryListInput, ctx: Ctx): Promise<Expense[]>;
  createExpense(input: CreateExpenseInput, ctx: Ctx): Promise<{ id: string }>;
  updateExpense(input: UpdateExpenseInput, ctx: Ctx): Promise<{ id: string }>;
  deleteExpense(input: DeleteExpenseInput, ctx: Ctx): Promise<{ id: string }>;
}

/** The event-bus surface the logic needs (from `@platform/cortex-core`). */
type Emit = (type: string, payload: unknown, ctx: Ctx) => Promise<void>;

/** Format a stored amount for display: fixed 2 decimals (the column is
 * numeric(12,2)). Shared by both views so they never drift on rounding. */
export function formatAmount(amount: number): string {
  return amount.toFixed(2);
}

/** Map a raw DB row to a typed expense (the DB uses snake_case columns). `amount`
 * comes back from a numeric column as a string over the wire, so coerce it to a
 * number here — the single place that conversion lives. */
function toExpense(row: DbRow): Expense {
  return {
    id: String(row.id),
    amount: Number(row.amount),
    category: row.category == null ? "general" : String(row.category),
    spentOn: String(row.spent_on).slice(0, 10),
    note: row.note == null ? "" : String(row.note),
  };
}

/** Today as an ISO date (YYYY-MM-DD) — the default `spent_on` when the caller
 * omits it. Matches the column's `default current_date`, resolved here so the
 * returned row is deterministic rather than depending on a DB round-trip. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function createExpensesLogic({
  db,
  emit: _emit,
}: {
  db: CortexDb;
  emit: Emit;
}): ExpensesLogic {
  return {
    async queryList(_input, ctx) {
      // A CONTEXT filter — "show me THIS org's expenses" — NOT a security filter.
      // Security lives in the DATABASE: `private.auth_user_can_read` behind expenses'
      // RLS policy, which ANDs org-tree membership before anything else. Delete
      // this filter and nothing becomes insecure — RLS would still refuse every
      // other org's rows; the user would simply see every org they belong to at
      // once, mixed together, which is a UX bug, not a leak.
      const rows = await db.select(EXPENSES_TABLE, { org_id: ctx.orgId });
      // Most recent spend first (spent_on desc), created_at desc as the tiebreak so
      // two expenses on the same day keep a stable, newest-first order. Both are
      // lexicographically sortable strings (ISO date / ISO timestamptz), so a plain
      // string compare is the ordering — no dependency on the adapter's tiny select.
      const ordered = [...rows].sort((a, b) => {
        const byDate = String(b.spent_on).localeCompare(String(a.spent_on));
        if (byDate !== 0) return byDate;
        return String(b.created_at).localeCompare(String(a.created_at));
      });
      return ordered.map(toExpense);
    },

    async createExpense(input, ctx) {
      const id = safeRandomUUID();
      const now = new Date().toISOString();
      await db.insert(EXPENSES_TABLE, {
        id,
        // The mandatory fields (§6). Both are NOT NULL on the table. `visibility`
        // is deliberately omitted — the column defaults to 'org'.
        owner_id: ctx.userId,
        org_id: ctx.orgId,
        // tool columns. amount is required; the rest fall back to the SAME values
        // the column defaults would give, resolved here so the row is deterministic.
        amount: input.amount,
        category: input.category ?? "general",
        spent_on: input.spentOn ?? today(),
        note: input.note ?? "",
        created_at: now,
        updated_at: now,
      });
      return { id };
    },

    async updateExpense(input, _ctx) {
      // RLS gates the update ROW BY ROW (auth_user_can_write behind the UPDATE
      // policy): a member may edit only rows they may write. The where is by id
      // alone — org scope is enforced by RLS, not this filter.
      //
      // Only the fields the caller actually sent are patched, so an edit of one
      // leaves the others untouched. `spentOn` maps to the `spent_on` column here.
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (input.amount !== undefined) patch.amount = input.amount;
      if (input.category !== undefined) patch.category = input.category;
      if (input.spentOn !== undefined) patch.spent_on = input.spentOn;
      if (input.note !== undefined) patch.note = input.note;
      await db.update(EXPENSES_TABLE, { id: input.id }, patch);
      return { id: input.id };
    },

    async deleteExpense(input, _ctx) {
      // RLS gates the delete ROW BY ROW (auth_user_can_write behind the DELETE
      // policy): a member may delete only rows they may write. The where is by id
      // alone — org scope is enforced by RLS, not this filter, exactly like update.
      await db.delete(EXPENSES_TABLE, { id: input.id });
      return { id: input.id };
    },
  };
}
