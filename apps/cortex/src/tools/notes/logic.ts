/**
 * Notes — internal business logic + event emission (Standard §2 `logic.ts`).
 *
 * Cloned from Tasks' logic. This is the ONLY place notes touches its data
 * (through the provided `CortexDb` client — never raw SQL) and the ONLY place it
 * would emit events (through the provided event-bus `emit`). It receives `ctx`
 * from the shell and never fetches identity itself.
 *
 * SCOPED BY `org_id`, AND ONLY BY `org_id`. The `notes` table (20260717000009)
 * mirrors tasks' security model exactly: `owner_id NOT NULL`, `org_id NOT NULL`,
 * `visibility` defaulting to 'org', RLS gating every read and write on org-tree
 * membership. The `org_id` filter below is a CONTEXT filter, not a security one —
 * RLS is the enforcement point (see the note in queryList).
 *
 * The writes below do NOT set `visibility`; the column defaults to 'org', exactly
 * as tasks' createTask does. Seeding `visibility` / grants from the manifest is
 * the same clean seam left open there — not this tool's job to invent.
 */
import { safeRandomUUID, type Ctx, type CortexDb, type DbRow } from "@platform/cortex-core";

export const NOTES_TABLE = "notes";

export interface Note {
  id: string;
  title: string;
  body: string;
}

/** query_list takes no input — the org comes from ctx, not the caller. */
export interface QueryListInput {}
export interface CreateNoteInput {
  title: string;
  body?: string;
}
export interface UpdateNoteInput {
  id: string;
  title?: string;
  body?: string;
}
export interface DeleteNoteInput {
  id: string;
}

export interface NotesLogic {
  queryList(input: QueryListInput, ctx: Ctx): Promise<Note[]>;
  createNote(input: CreateNoteInput, ctx: Ctx): Promise<{ id: string }>;
  updateNote(input: UpdateNoteInput, ctx: Ctx): Promise<{ id: string }>;
  deleteNote(input: DeleteNoteInput, ctx: Ctx): Promise<{ id: string }>;
}

/** The event-bus surface the logic needs (from `@platform/cortex-core`). */
type Emit = (type: string, payload: unknown, ctx: Ctx) => Promise<void>;

/** Map a raw DB row to a typed note (the DB uses snake_case columns). `body`
 * defaults to '' on the table, so it is never null — but coerce defensively. */
function toNote(row: DbRow): Note {
  return {
    id: String(row.id),
    title: String(row.title),
    body: row.body == null ? "" : String(row.body),
  };
}

export function createNotesLogic({ db, emit: _emit }: { db: CortexDb; emit: Emit }): NotesLogic {
  return {
    async queryList(_input, ctx) {
      // A CONTEXT filter — "show me THIS org's notes" — NOT a security filter.
      // Security lives in the DATABASE: `private.auth_user_can_read` behind notes'
      // RLS policy, which ANDs org-tree membership before anything else. Delete
      // this filter and nothing becomes insecure — RLS would still refuse every
      // other org's rows; the user would simply see every org they belong to at
      // once, mixed together, which is a UX bug, not a leak.
      const rows = await db.select(NOTES_TABLE, { org_id: ctx.orgId });
      // Order by created_at. ISO timestamptz strings sort lexicographically in
      // chronological order, so a plain string compare is the ordering — no
      // dependency on the adapter's (deliberately tiny) select surface.
      const ordered = [...rows].sort((a, b) =>
        String(a.created_at).localeCompare(String(b.created_at)),
      );
      return ordered.map(toNote);
    },

    async createNote(input, ctx) {
      const id = safeRandomUUID();
      const now = new Date().toISOString();
      await db.insert(NOTES_TABLE, {
        id,
        // The mandatory fields (§6). Both are NOT NULL on the table. `visibility`
        // is deliberately omitted — the column defaults to 'org'.
        owner_id: ctx.userId,
        org_id: ctx.orgId,
        // tool columns
        title: input.title,
        body: input.body ?? "",
        created_at: now,
        updated_at: now,
      });
      return { id };
    },

    async updateNote(input, _ctx) {
      // RLS gates the update ROW BY ROW (auth_user_can_write behind the UPDATE
      // policy): a member may edit only rows they may write. The where is by id
      // alone — org scope is enforced by RLS, not this filter.
      //
      // Only the fields the caller actually sent are patched: title? and body?
      // are each optional, so an edit of one leaves the other untouched.
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (input.title !== undefined) patch.title = input.title;
      if (input.body !== undefined) patch.body = input.body;
      await db.update(NOTES_TABLE, { id: input.id }, patch);
      return { id: input.id };
    },

    async deleteNote(input, _ctx) {
      // RLS gates the delete ROW BY ROW (auth_user_can_write behind the DELETE
      // policy): a member may delete only rows they may write. The where is by id
      // alone — org scope is enforced by RLS, not this filter, exactly like update.
      await db.delete(NOTES_TABLE, { id: input.id });
      return { id: input.id };
    },
  };
}
