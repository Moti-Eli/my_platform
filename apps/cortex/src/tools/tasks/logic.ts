/**
 * Tasks — internal business logic + event emission (Standard §2 `logic.ts`).
 *
 * The second tool, cloned from Inventory's logic. This is the ONLY place tasks
 * touches its data (through the provided `CortexDb` client — never raw SQL) and
 * the ONLY place it emits events (through the provided event-bus `emit`). It
 * receives `ctx` from the shell and never fetches identity itself.
 *
 * SCOPED BY `org_id`, AND ONLY BY `org_id`. The `tasks` table (20260717000006)
 * mirrors inventory_items' security model exactly: `owner_id NOT NULL`,
 * `org_id NOT NULL`, `visibility` defaulting to 'org', RLS gating every read and
 * write on org-tree membership. The `org_id` filter below is a CONTEXT filter,
 * not a security one — RLS is the enforcement point (see the note in queryList).
 *
 * The writes below do NOT set `visibility`; the column defaults to 'org', exactly
 * as inventory's addProduct does. Seeding `visibility` / grants from the manifest
 * is the same clean seam left open there — not this tool's job to invent.
 */
import { safeRandomUUID, type Ctx, type CortexDb, type DbRow } from "@platform/cortex-core";

export const TASKS_TABLE = "tasks";

export interface Task {
  id: string;
  title: string;
  done: boolean;
  dueDate: string | null;
  /** A key from `categories.ts` (`CATEGORIES`), or null for "no category". Not
   * validated against that list here — an unrecognized/stale value just falls
   * back to "no category" wherever it's displayed (see `categoryOf`). */
  category: string | null;
}

/** query_list takes no input — the org comes from ctx, not the caller. */
export interface QueryListInput {}
export interface CreateTaskInput {
  title: string;
  dueDate?: string;
  category?: string;
}
export interface ToggleTaskInput {
  id: string;
  done: boolean;
}
/** All three OPTIONAL: `undefined` means "leave this column alone", while
 * `dueDate: null` / `category: null` are real values — "clear the due date" /
 * "no category". */
export interface UpdateTaskInput {
  id: string;
  title?: string;
  dueDate?: string | null;
  category?: string | null;
}
export interface DeleteTaskInput {
  id: string;
}

export interface TasksLogic {
  queryList(input: QueryListInput, ctx: Ctx): Promise<Task[]>;
  createTask(input: CreateTaskInput, ctx: Ctx): Promise<{ id: string }>;
  toggleTask(input: ToggleTaskInput, ctx: Ctx): Promise<{ id: string; done: boolean }>;
  updateTask(input: UpdateTaskInput, ctx: Ctx): Promise<{ id: string }>;
  deleteTask(input: DeleteTaskInput, ctx: Ctx): Promise<{ id: string }>;
}

/** The event-bus surface the logic needs (from `@platform/cortex-core`). */
type Emit = (type: string, payload: unknown, ctx: Ctx) => Promise<void>;

/** Map a raw DB row to a typed task (the DB uses snake_case columns). */
function toTask(row: DbRow): Task {
  return {
    id: String(row.id),
    title: String(row.title),
    done: Boolean(row.done),
    dueDate: row.due_date == null ? null : String(row.due_date),
    category: row.category == null ? null : String(row.category),
  };
}

export function createTasksLogic({ db, emit }: { db: CortexDb; emit: Emit }): TasksLogic {
  return {
    async queryList(_input, ctx) {
      // A CONTEXT filter — "show me THIS org's tasks" — NOT a security filter.
      // Security lives in the DATABASE: `private.auth_user_can_read` behind tasks'
      // RLS policy, which ANDs org-tree membership before anything else. Delete
      // this filter and nothing becomes insecure — RLS would still refuse every
      // other org's rows; the user would simply see every org they belong to at
      // once, mixed together, which is a UX bug, not a leak.
      const rows = await db.select(TASKS_TABLE, { org_id: ctx.orgId });
      // Order by created_at. ISO timestamptz strings sort lexicographically in
      // chronological order, so a plain string compare is the ordering — no
      // dependency on the adapter's (deliberately tiny) select surface.
      const ordered = [...rows].sort((a, b) =>
        String(a.created_at).localeCompare(String(b.created_at)),
      );
      return ordered.map(toTask);
    },

    async createTask(input, ctx) {
      const id = safeRandomUUID();
      const now = new Date().toISOString();
      await db.insert(TASKS_TABLE, {
        id,
        // The mandatory fields (§6). Both are NOT NULL on the table. `visibility`
        // is deliberately omitted — the column defaults to 'org'.
        owner_id: ctx.userId,
        org_id: ctx.orgId,
        // tool columns
        title: input.title,
        due_date: input.dueDate ?? null,
        category: input.category ?? null,
        created_at: now,
        updated_at: now,
      });
      // Announce the creation; the tool doesn't know (or care) who listens.
      await emit("tasks.created", { id, title: input.title }, ctx);
      return { id };
    },

    async toggleTask(input, ctx) {
      await db.update(
        TASKS_TABLE,
        { id: input.id },
        { done: input.done, updated_at: new Date().toISOString() },
      );
      // Only a transition INTO done is worth announcing (a completion). Flipping
      // back to open is not an event anyone waits on.
      if (input.done) {
        await emit("tasks.completed", { id: input.id }, ctx);
      }
      return { id: input.id, done: input.done };
    },

    async updateTask(input, _ctx) {
      // Where by id alone — org scope is enforced by RLS
      // (auth_user_can_write), not by this filter, exactly like toggleTask.
      // Only the fields actually provided are sent: a missing field must
      // never overwrite a column the caller didn't mention.
      await db.update(
        TASKS_TABLE,
        { id: input.id },
        {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.dueDate !== undefined ? { due_date: input.dueDate } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          updated_at: new Date().toISOString(),
        },
      );
      return { id: input.id };
    },

    async deleteTask(input, _ctx) {
      // RLS gates the delete ROW BY ROW (auth_user_can_write behind the DELETE
      // policy): a member may delete only rows they may write. The where is by id
      // alone — org scope is enforced by RLS, not this filter, exactly like update.
      await db.delete(TASKS_TABLE, { id: input.id });
      return { id: input.id };
    },
  };
}
