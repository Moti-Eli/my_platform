/**
 * Time entries — internal business logic + event emission (Standard §2 `logic.ts`).
 *
 * Cloned from Journal's logic. This is the ONLY place time_entries touches its
 * data (through the provided `CortexDb` client — never raw SQL) and the ONLY
 * place it would emit events (through the provided event-bus `emit`). It receives
 * `ctx` from the shell and never fetches identity itself.
 *
 * SCOPED BY `org_id`, AND ONLY BY `org_id`. The `time_entries` table
 * (20260723000004) is the FIRST tool table BORN 'private': RLS gates every read
 * via `auth_user_can_read` (owner, or a tree admin) and every write via
 * `auth_user_can_write` (owner only). The `org_id` filter below is a CONTEXT
 * filter, not a security one — RLS is the enforcement point (see queryList).
 *
 * BORN-PRIVATE, STAMPED EXPLICITLY. Unlike notes/journal (which omit `visibility`
 * and lean on the column's 'org' default), every insert here sets `visibility`
 * EXPLICITLY from THIS tool's own manifest (`manifest.defaultVisibility`). The DB
 * column default ('private') is only the FAIL-SAFE half: if the write path ever
 * dropped the value the row must fail CLOSED (owner-only), never publish to the
 * whole tree. Stamping it here makes the born-private intent the source of truth,
 * not a silent database default.
 *
 * DB ↔ JS NAMING: the DB column is snake_case `work_date`; the tool exposes it as
 * `workDate`. `toEntry` and the write paths are the single place that mapping lives.
 */
import { safeRandomUUID, type Ctx, type CortexDb, type DbRow } from "@platform/cortex-core";
import { manifest } from "./manifest";

export const TIME_ENTRIES_TABLE = "time_entries";

export interface TimeEntry {
  id: string;
  /** Row owner. Needed by the upcoming admin (manager) view to group entries per
   * employee; RLS already scopes which rows arrive (member: own only; tree-admin:
   * everyone's), so this is a grouping key, never an access decision. */
  ownerId: string;
  workDate: string;
  hours: number;
  note: string;
}

/** query_list takes no input — the org comes from ctx, not the caller. */
export interface QueryListInput {}
export interface CreateEntryInput {
  hours: number;
  workDate?: string;
  note?: string;
}
export interface UpdateEntryInput {
  id: string;
  hours?: number;
  workDate?: string;
  note?: string;
}
export interface DeleteEntryInput {
  id: string;
}

export interface TimeEntriesLogic {
  queryList(input: QueryListInput, ctx: Ctx): Promise<TimeEntry[]>;
  createEntry(input: CreateEntryInput, ctx: Ctx): Promise<{ id: string }>;
  updateEntry(input: UpdateEntryInput, ctx: Ctx): Promise<{ id: string }>;
  deleteEntry(input: DeleteEntryInput, ctx: Ctx): Promise<{ id: string }>;
}

/** The event-bus surface the logic needs (from `@platform/cortex-core`). */
type Emit = (type: string, payload: unknown, ctx: Ctx) => Promise<void>;

/** Map a raw DB row to a typed entry (the DB uses snake_case columns). `hours` is
 * numeric — coerced to a JS number; `note` is NOT NULL (defaults '' on the table),
 * so it is never null. */
function toEntry(row: DbRow): TimeEntry {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    workDate: String(row.work_date).slice(0, 10),
    hours: Number(row.hours),
    note: row.note == null ? "" : String(row.note),
  };
}

/** Today as an ISO date (YYYY-MM-DD) — the default `work_date` when the caller
 * omits it. Matches the column's `default current_date`, resolved here so the
 * returned row is deterministic rather than depending on a DB round-trip. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The hours domain: strictly greater than 0, at most 24 — the SAME bound as the
 * DB CHECK (`hours > 0 and hours <= 24`). Enforced here too so a bad value is
 * refused before the round-trip, mirroring the views' visible validation. */
function isValidHours(h: number): boolean {
  return Number.isFinite(h) && h > 0 && h <= 24;
}

export function createTimeEntriesLogic({
  db,
  emit: _emit,
}: {
  db: CortexDb;
  emit: Emit;
}): TimeEntriesLogic {
  return {
    async queryList(_input, ctx) {
      // A CONTEXT filter — "show me THIS org's time entries" — NOT a security
      // filter. Security lives in the DATABASE: `private.auth_user_can_read` behind
      // the SELECT policy, which ANDs org-tree membership, then owner/tree-admin for
      // 'private'. Delete this filter and nothing becomes insecure — RLS would still
      // refuse every other org's rows; the user would simply see every org they
      // belong to at once, which is a UX bug, not a leak.
      const rows = await db.select(TIME_ENTRIES_TABLE, { org_id: ctx.orgId });
      // Most recent work_date first, created_at desc as the tiebreak so two entries
      // on the same day keep a stable, newest-first order. Both are lexicographically
      // sortable strings (ISO date / ISO timestamptz), so a plain string compare is
      // the ordering — no dependency on the adapter's tiny select.
      const ordered = [...rows].sort((a, b) => {
        const byDate = String(b.work_date).localeCompare(String(a.work_date));
        if (byDate !== 0) return byDate;
        return String(b.created_at).localeCompare(String(a.created_at));
      });
      return ordered.map(toEntry);
    },

    async createEntry(input, ctx) {
      // Domain guard (0 < hours <= 24) — the DB CHECK is the enforcement point;
      // this refuses an out-of-range write before the round-trip, matching the views.
      if (!isValidHours(input.hours)) {
        throw new Error("time_entries: hours must be greater than 0 and at most 24");
      }
      const id = safeRandomUUID();
      const now = new Date().toISOString();
      await db.insert(TIME_ENTRIES_TABLE, {
        id,
        // The mandatory fields (§6). Both are NOT NULL on the table.
        owner_id: ctx.userId,
        org_id: ctx.orgId,
        // BORN PRIVATE — stamp `visibility` EXPLICITLY from THIS tool's manifest,
        // never omitting it. Unlike the 'org'-default tools, this tool is the source
        // of truth for its rows' visibility; the DB column default ('private') is
        // only the FAIL-SAFE half — if this value were ever dropped the row must
        // fail CLOSED (owner-only), never open to the whole tree.
        visibility: manifest.defaultVisibility,
        // tool columns. hours is required; work_date falls back to the SAME value the
        // column default would give; note is NOT NULL (defaults '' on the table).
        hours: input.hours,
        work_date: input.workDate ?? today(),
        note: input.note ?? "",
        created_at: now,
        updated_at: now,
      });
      return { id };
    },

    async updateEntry(input, _ctx) {
      // RLS gates the update ROW BY ROW (auth_user_can_write behind the UPDATE
      // policy — owner only on 'private'): a member may edit only rows they may
      // write. The where is by id alone — org scope is enforced by RLS, not this
      // filter.
      //
      // Domain guard on hours when it is being changed (same (0, 24] bound as create).
      if (input.hours !== undefined && !isValidHours(input.hours)) {
        throw new Error("time_entries: hours must be greater than 0 and at most 24");
      }
      // Only the fields the caller actually sent are patched, so an edit of one
      // leaves the others untouched. `visibility` is deliberately NOT patched here —
      // it is frozen after insert by the DB immutability trigger (20260716000007),
      // and a born-private row stays private. `workDate` maps to `work_date`.
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (input.hours !== undefined) patch.hours = input.hours;
      if (input.workDate !== undefined) patch.work_date = input.workDate;
      if (input.note !== undefined) patch.note = input.note;
      await db.update(TIME_ENTRIES_TABLE, { id: input.id }, patch);
      return { id: input.id };
    },

    async deleteEntry(input, _ctx) {
      // RLS gates the delete ROW BY ROW (auth_user_can_write behind the DELETE
      // policy — owner only): a member may delete only rows they may write. The
      // where is by id alone — org scope is enforced by RLS, not this filter.
      await db.delete(TIME_ENTRIES_TABLE, { id: input.id });
      return { id: input.id };
    },
  };
}
