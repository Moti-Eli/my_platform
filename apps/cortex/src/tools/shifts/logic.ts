/**
 * Shifts — internal business logic (Standard §2 `logic.ts`).
 *
 * The ONLY place shifts touches its data (through the provided `CortexDb` —
 * never raw SQL). It receives `ctx` from the shell and never fetches identity.
 *
 * Stage 1, part 1: POSITIONS only (public.shift_positions, 20261008000001).
 * Employees, shift templates and requirements are added in the next parts.
 *
 * RLS is the enforcement point: reads are open to the org tree, every write
 * needs `shifts.manage` (managers). The `org_id` filter is a CONTEXT filter.
 * Writes do not set `visibility` — it defaults to 'org'.
 */
import { safeRandomUUID, type Ctx, type CortexDb, type DbRow } from "@platform/cortex-core";

export const POSITIONS_TABLE = "shift_positions";

export interface Position {
  id: string;
  name: string;
  /** Display order (ascending). Ties sort by name. */
  position: number;
}

/** Every list_* takes no input — the org comes from ctx, not the caller. */
export interface ListInput {}
export interface IdInput {
  id: string;
}
export interface CreatePositionInput {
  name: string;
  /** Where to put it — the views send "after the last one". */
  position: number;
}
export interface RenamePositionInput {
  id: string;
  name: string;
}
export interface ReorderPositionsInput {
  /** Every position id, in the new display order. */
  ids: string[];
}

export interface ShiftsLogic {
  listPositions(input: ListInput, ctx: Ctx): Promise<Position[]>;
  createPosition(input: CreatePositionInput, ctx: Ctx): Promise<{ id: string }>;
  renamePosition(input: RenamePositionInput, ctx: Ctx): Promise<{ id: string }>;
  reorderPositions(input: ReorderPositionsInput, ctx: Ctx): Promise<{ count: number }>;
  deletePosition(input: IdInput, ctx: Ctx): Promise<{ id: string }>;
}

/** The event-bus surface the logic needs (from `@platform/cortex-core`). */
type Emit = (type: string, payload: unknown, ctx: Ctx) => Promise<void>;

function toPosition(row: DbRow): Position {
  return {
    id: String(row.id),
    name: String(row.name),
    position: Number(row.position ?? 0),
  };
}

export function createShiftsLogic({ db, emit: _emit }: { db: CortexDb; emit: Emit }): ShiftsLogic {
  return {
    async listPositions(_input, ctx) {
      const rows = await db.select(POSITIONS_TABLE, { org_id: ctx.orgId });
      return rows.map(toPosition);
    },

    async createPosition(input, ctx) {
      const id = safeRandomUUID();
      const now = new Date().toISOString();
      await db.insert(POSITIONS_TABLE, {
        id,
        // Mandatory fields (§6). `visibility` omitted — defaults to 'org'.
        owner_id: ctx.userId,
        org_id: ctx.orgId,
        name: input.name,
        position: input.position,
        created_at: now,
        updated_at: now,
      });
      return { id };
    },

    async renamePosition(input, _ctx) {
      await db.update(
        POSITIONS_TABLE,
        { id: input.id },
        { name: input.name, updated_at: new Date().toISOString() },
      );
      return { id: input.id };
    },

    async reorderPositions(input, _ctx) {
      // One server call; each row gets its index as `position`. CortexDb updates
      // one row at a time, so this is not atomic — a failure part-way leaves a
      // partial order, which the next reorder simply rewrites.
      const now = new Date().toISOString();
      for (const [index, id] of input.ids.entries()) {
        await db.update(POSITIONS_TABLE, { id }, { position: index, updated_at: now });
      }
      return { count: input.ids.length };
    },

    async deletePosition(input, _ctx) {
      // Refused by the DB while a shift requirement still uses the position
      // (ON DELETE RESTRICT, 20261008000005). Employee links cascade.
      await db.delete(POSITIONS_TABLE, { id: input.id });
      return { id: input.id };
    },
  };
}
