/**
 * Shopping — internal business logic (Standard §2 `logic.ts`).
 *
 * Stage 1, step 1 registers the tool and its one privileged write: creating a
 * list, which also creates the list's own root organization and installs the
 * tool there (see create-list-core.ts). That write needs the service client, so
 * it is INJECTED — the server passes the real implementation, the client a
 * throwing stub (same seam as candidates.invite). List and item CRUD through the
 * injected `db` comes with the screens.
 */
import type { Ctx, CortexDb } from "@platform/cortex-core";

export const LISTS_TABLE = "shopping_lists";
export const ITEMS_TABLE = "shopping_list_items";

/** Mirrors shopping_lists.name CHECK (1–100). */
export const LIST_NAME_MAX = 100;

export interface CreateListInput {
  name: string;
}

/** The new list and the org it lives in — the caller switches to `orgId`. */
export interface CreateListResult {
  listId: string;
  orgId: string;
}

export interface ShoppingLogic {
  createList(input: CreateListInput, ctx: Ctx): Promise<CreateListResult>;
}

type Emit = (type: string, payload: unknown, ctx: Ctx) => Promise<void>;

export function createShoppingLogic({
  db: _db,
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
    createList,
  };
}
