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
import { safeRandomUUID, type Ctx, type CortexDb, type DbRow } from "@platform/cortex-core";

export const LISTS_TABLE = "shopping_lists";
export const ITEMS_TABLE = "shopping_list_items";

/** Mirrors shopping_lists.name CHECK (1–100). */
export const LIST_NAME_MAX = 100;
/** Mirrors shopping_list_items.name CHECK (1–200). */
export const ITEM_NAME_MAX = 200;
/** Mirrors shopping_list_items.quantity CHECK (<= 50; '' = none). */
export const QUANTITY_MAX = 50;

export interface List {
  id: string;
  name: string;
}

export interface Item {
  id: string;
  name: string;
  /** Free text ("2", "1 kg"); '' = none. */
  quantity: string;
  checked: boolean;
  createdAt: string;
}

export interface AddItemInput {
  listId: string;
  name: string;
  quantity: string;
}
export interface UpdateItemInput {
  id: string;
  name: string;
  quantity: string;
}
export interface SetCheckedInput {
  id: string;
  checked: boolean;
}
export interface DeleteItemInput {
  id: string;
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
  /** The active org's items (its one list's). */
  listItems(input: Record<string, never>, ctx: Ctx): Promise<Item[]>;
  addItem(input: AddItemInput, ctx: Ctx): Promise<{ id: string; createdAt: string }>;
  updateItem(input: UpdateItemInput, ctx: Ctx): Promise<{ id: string }>;
  setChecked(input: SetCheckedInput, ctx: Ctx): Promise<{ id: string }>;
  deleteItem(input: DeleteItemInput, ctx: Ctx): Promise<{ id: string }>;
}

type Emit = (type: string, payload: unknown, ctx: Ctx) => Promise<void>;

function toList(row: DbRow): List {
  return { id: String(row.id), name: String(row.name) };
}

function toItem(row: DbRow): Item {
  return {
    id: String(row.id),
    name: String(row.name),
    quantity: String(row.quantity ?? ""),
    checked: row.checked === true,
    createdAt: String(row.created_at),
  };
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

    async listItems(_input, ctx) {
      const rows = await db.select(ITEMS_TABLE, { org_id: ctx.orgId });
      return rows.map(toItem);
    },

    async addItem(input, ctx) {
      // org_id is the active org; the composite FK (list_id, org_id) refuses an
      // item whose list is in another org.
      const id = safeRandomUUID();
      const now = new Date().toISOString();
      await db.insert(ITEMS_TABLE, {
        id,
        owner_id: ctx.userId,
        org_id: ctx.orgId,
        list_id: input.listId,
        name: input.name,
        quantity: input.quantity,
        created_at: now,
        updated_at: now,
      });
      return { id, createdAt: now };
    },

    async updateItem(input, _ctx) {
      await db.update(
        ITEMS_TABLE,
        { id: input.id },
        { name: input.name, quantity: input.quantity, updated_at: new Date().toISOString() },
      );
      return { id: input.id };
    },

    async setChecked(input, _ctx) {
      await db.update(
        ITEMS_TABLE,
        { id: input.id },
        { checked: input.checked, updated_at: new Date().toISOString() },
      );
      return { id: input.id };
    },

    async deleteItem(input, _ctx) {
      await db.delete(ITEMS_TABLE, { id: input.id });
      return { id: input.id };
    },
  };
}
