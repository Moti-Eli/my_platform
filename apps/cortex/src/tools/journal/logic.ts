/**
 * Journal — internal business logic + event emission (Standard §2 `logic.ts`).
 *
 * Cloned from Notes' logic. This is the ONLY place journal touches its data
 * (through the provided `CortexDb` client — never raw SQL) and the ONLY place it
 * would emit events (through the provided event-bus `emit`). It receives `ctx`
 * from the shell and never fetches identity itself.
 *
 * SCOPED BY `org_id`, AND ONLY BY `org_id`. The `journal` table (20260717000011)
 * mirrors notes' security model exactly: `owner_id NOT NULL`, `org_id NOT NULL`,
 * `visibility` defaulting to 'org', RLS gating every read and write on org-tree
 * membership. The `org_id` filter below is a CONTEXT filter, not a security one —
 * RLS is the enforcement point (see the note in queryList).
 *
 * The writes below do NOT set `visibility`; the column defaults to 'org', exactly
 * as notes' createNote does. Seeding `visibility` / grants from the manifest is
 * the same clean seam left open there — not this tool's job to invent.
 *
 * DB ↔ JS NAMING: the DB column is snake_case `entry_date`; the tool exposes it as
 * `entryDate`. `toEntry` and the write paths are the single place that mapping lives.
 */
import { safeRandomUUID, type Ctx, type CortexDb, type DbRow } from "@platform/cortex-core";

export const JOURNAL_TABLE = "journal";

export interface Entry {
  id: string;
  entryDate: string;
  content: string;
  mood: string | null;
}

/** query_list takes no input — the org comes from ctx, not the caller. */
export interface QueryListInput {}
export interface CreateEntryInput {
  content: string;
  entryDate?: string;
  mood?: string;
}
export interface UpdateEntryInput {
  id: string;
  content?: string;
  entryDate?: string;
  mood?: string;
}
export interface DeleteEntryInput {
  id: string;
}

export interface JournalLogic {
  queryList(input: QueryListInput, ctx: Ctx): Promise<Entry[]>;
  createEntry(input: CreateEntryInput, ctx: Ctx): Promise<{ id: string }>;
  updateEntry(input: UpdateEntryInput, ctx: Ctx): Promise<{ id: string }>;
  deleteEntry(input: DeleteEntryInput, ctx: Ctx): Promise<{ id: string }>;
}

/** The event-bus surface the logic needs (from `@platform/cortex-core`). */
type Emit = (type: string, payload: unknown, ctx: Ctx) => Promise<void>;

/** Map a raw DB row to a typed entry (the DB uses snake_case columns). `mood` is
 * the one NULLABLE column — it stays `null` when unset rather than coercing to ''
 * — while `content` defaults to '' on the table, so it is never null. */
function toEntry(row: DbRow): Entry {
  return {
    id: String(row.id),
    entryDate: String(row.entry_date).slice(0, 10),
    content: row.content == null ? "" : String(row.content),
    mood: row.mood == null ? null : String(row.mood),
  };
}

/** Today as an ISO date (YYYY-MM-DD) — the default `entry_date` when the caller
 * omits it. Matches the column's `default current_date`, resolved here so the
 * returned row is deterministic rather than depending on a DB round-trip. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function createJournalLogic({
  db,
  emit: _emit,
}: {
  db: CortexDb;
  emit: Emit;
}): JournalLogic {
  return {
    async queryList(_input, ctx) {
      // A CONTEXT filter — "show me THIS org's journal" — NOT a security filter.
      // Security lives in the DATABASE: `private.auth_user_can_read` behind journal's
      // RLS policy, which ANDs org-tree membership before anything else. Delete
      // this filter and nothing becomes insecure — RLS would still refuse every
      // other org's rows; the user would simply see every org they belong to at
      // once, mixed together, which is a UX bug, not a leak.
      const rows = await db.select(JOURNAL_TABLE, { org_id: ctx.orgId });
      // Most recent entry first (entry_date desc), created_at desc as the tiebreak so
      // two entries on the same day keep a stable, newest-first order. Both are
      // lexicographically sortable strings (ISO date / ISO timestamptz), so a plain
      // string compare is the ordering — no dependency on the adapter's tiny select.
      const ordered = [...rows].sort((a, b) => {
        const byDate = String(b.entry_date).localeCompare(String(a.entry_date));
        if (byDate !== 0) return byDate;
        return String(b.created_at).localeCompare(String(a.created_at));
      });
      return ordered.map(toEntry);
    },

    async createEntry(input, ctx) {
      const id = safeRandomUUID();
      const now = new Date().toISOString();
      await db.insert(JOURNAL_TABLE, {
        id,
        // The mandatory fields (§6). Both are NOT NULL on the table. `visibility`
        // is deliberately omitted — the column defaults to 'org'.
        owner_id: ctx.userId,
        org_id: ctx.orgId,
        // tool columns. content is required; entry_date falls back to the SAME value
        // the column default would give; mood is nullable, so an unset mood is NULL.
        content: input.content,
        entry_date: input.entryDate ?? today(),
        mood: input.mood ?? null,
        created_at: now,
        updated_at: now,
      });
      return { id };
    },

    async updateEntry(input, _ctx) {
      // RLS gates the update ROW BY ROW (auth_user_can_write behind the UPDATE
      // policy): a member may edit only rows they may write. The where is by id
      // alone — org scope is enforced by RLS, not this filter.
      //
      // Only the fields the caller actually sent are patched, so an edit of one
      // leaves the others untouched. `entryDate` maps to the `entry_date` column here.
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (input.content !== undefined) patch.content = input.content;
      if (input.entryDate !== undefined) patch.entry_date = input.entryDate;
      if (input.mood !== undefined) patch.mood = input.mood;
      await db.update(JOURNAL_TABLE, { id: input.id }, patch);
      return { id: input.id };
    },

    async deleteEntry(input, _ctx) {
      // RLS gates the delete ROW BY ROW (auth_user_can_write behind the DELETE
      // policy): a member may delete only rows they may write. The where is by id
      // alone — org scope is enforced by RLS, not this filter, exactly like update.
      await db.delete(JOURNAL_TABLE, { id: input.id });
      return { id: input.id };
    },
  };
}
