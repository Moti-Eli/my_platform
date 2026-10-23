/**
 * Shopping — internal business logic (Standard §2 `logic.ts`).
 *
 * Stage 1, step 1 registers the tool and its one privileged write: creating a
 * list, which also creates the list's own root organization and installs the
 * tool there (see create-list-core.ts). That write needs the service client, so
 * it is INJECTED — the server passes the real implementation, the client a
 * throwing stub (same seam as candidates.invite).
 *
 * SCOPED BY `org_id`: every list lives in its own org, so the active org holds
 * at most one list (`shopping_lists_org_id_key`). The filter is a CONTEXT filter,
 * not a security one — RLS is the enforcement point.
 */
import type { Ctx, CortexDb, DbRow } from "@platform/cortex-core";

export const LISTS_TABLE = "shopping_lists";
export const ITEMS_TABLE = "shopping_list_items";

/** Mirrors shopping_lists.name CHECK (1–100). */
export const LIST_NAME_MAX = 100;

export interface List {
  id: string;
  name: string;
}

export interface CreateListInput {
  name: string;
}

/** The new list and the org it lives in — the caller switches to `orgId`. */
export interface CreateListResult {
  listId: string;
  orgId: string;
}

export interface ShoppingLogic {
  /** The active org's list, or null when the active org is not a list org. */
  getList(input: Record<string, never>, ctx: Ctx): Promise<List | null>;
  createList(input: CreateListInput, ctx: Ctx): Promise<CreateListResult>;
}

type Emit = (type: string, payload: unknown, ctx: Ctx) => Promise<void>;

function toList(row: DbRow): List {
  return { id: String(row.id), name: String(row.name) };
}

export function createShoppingLogic({
  db,
  emit: _emit,
  createList,
}: {
  db: CortexDb;
  emit: Emit;
  /** INJECTED — the server passes the real implementation; the client passes a
   *  throwing stub (createList never runs client-side). */
  createList: (input: CreateListInput, ctx: Ctx) => Promise<CreateListResult>;
}): ShoppingLogic {
  return {
    async getList(_input, ctx) {
      const rows = await db.select(LISTS_TABLE, { org_id: ctx.orgId });
      const first = rows[0];
      return first ? toList(first) : null;
    },
    createList,
  };
}
