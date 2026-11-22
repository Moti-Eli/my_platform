/**
 * Shopping — internal business logic (Standard §2 `logic.ts`).
 *
 * Stage 1, step 1 registers the tool and its one privileged write: creating a
 * list, which also creates the list's own root organization and installs the
 * tool there (see create-list-core.ts). That write needs the service client, so
 * it is INJECTED — the server passes the real implementation, the client a
 * throwing stub (same seam as candidates.invite).
 *
 * Every list lives in its own org (`shopping_lists_org_id_key`). Stage 2 reads
 * ACROSS orgs: "My lists" is every list RLS lets the user read — the lists of
 * every org they are a member of (created or shared) — with NO org filter, and a
 * list opens by its id, without switching the active org. RLS is the
 * enforcement point (`auth_user_can_read` / `can_write`: a member of the list's
 * org). A new item takes its LIST's org, never the active one (the composite FK
 * (list_id, org_id) requires it). The active-org reads (`getList` / `listItems`
 * with no id) remain for the Home card until it moves to "My lists".
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
  /** The list's own org. */
  orgId: string;
}

/** A list on "My lists", with its item counts. */
export interface ListSummary extends List {
  /** Items not checked off yet. */
  toBuy: number;
  total: number;
}

/** No id = the active org's list (the Home card); an id = that list. */
export interface GetListInput {
  id?: string;
}
/** No listId = the active org's items (the Home card); a listId = that list's. */
export interface ListItemsInput {
  listId?: string;
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

export interface RenameListInput {
  id: string;
  name: string;
}
export interface DeleteListInput {
  id: string;
}
/** A refusal the screen explains; anything else is thrown (generic failure). */
export type DeleteListResult =
  | { deleted: true }
  | { error: "lastOrg" | "otherMembers" | "hideFailed" };

export interface CreateListInput {
  name: string;
}

/** The new list and the org it lives in — the caller switches to `orgId`. */
export interface CreateListResult {
  listId: string;
  orgId: string;
}

export interface ShoppingLogic {
  /** Every list the user can read, across all their orgs, with item counts. */
  listLists(input: Record<string, never>, ctx: Ctx): Promise<ListSummary[]>;
  /** One list by id, or the active org's list when no id; null when none. */
  getList(input: GetListInput, ctx: Ctx): Promise<List | null>;
  createList(input: CreateListInput, ctx: Ctx): Promise<CreateListResult>;
  renameList(input: RenameListInput, ctx: Ctx): Promise<{ id: string }>;
  deleteList(input: DeleteListInput, ctx: Ctx): Promise<DeleteListResult>;
  /** One list's items, or the active org's when no listId. */
  listItems(input: ListItemsInput, ctx: Ctx): Promise<Item[]>;
  addItem(input: AddItemInput, ctx: Ctx): Promise<{ id: string; createdAt: string }>;
  updateItem(input: UpdateItemInput, ctx: Ctx): Promise<{ id: string }>;
  setChecked(input: SetCheckedInput, ctx: Ctx): Promise<{ id: string }>;
  deleteItem(input: DeleteItemInput, ctx: Ctx): Promise<{ id: string }>;
}

type Emit = (type: string, payload: unknown, ctx: Ctx) => Promise<void>;

function toList(row: DbRow): List {
  return { id: String(row.id), name: String(row.name), orgId: String(row.org_id) };
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
  deleteList,
}: {
  db: CortexDb;
  emit: Emit;
  /** INJECTED — the server passes the real implementation; the client passes a
   *  throwing stub (createList never runs client-side). */
  createList: (input: CreateListInput, ctx: Ctx) => Promise<CreateListResult>;
  /** INJECTED, same as createList — it hides the list's org (service client). */
  deleteList: (input: DeleteListInput, ctx: Ctx) => Promise<DeleteListResult>;
}): ShoppingLogic {
  return {
    async listLists(_input, _ctx) {
      // NO org filter on purpose: RLS returns exactly the lists of the orgs the
      // user is a member of. One read of the not-yet-bought items for the counts.
      const lists = (await db.select(LISTS_TABLE)).map(toList);
      const items = await db.select(ITEMS_TABLE);
      return lists.map((l) => {
        const mine = items.filter((i) => String(i.list_id) === l.id);
        return { ...l, total: mine.length, toBuy: mine.filter((i) => i.checked !== true).length };
      });
    },

    async getList(input, ctx) {
      const rows = await db.select(LISTS_TABLE, input.id ? { id: input.id } : { org_id: ctx.orgId });
      const first = rows[0];
      return first ? toList(first) : null;
    },
    createList,

    async renameList(input, _ctx) {
      // The list's name only — the org's name never changes.
      await db.update(
        LISTS_TABLE,
        { id: input.id },
        { name: input.name, updated_at: new Date().toISOString() },
      );
      return { id: input.id };
    },

    deleteList,

    async listItems(input, ctx) {
      const rows = await db.select(
        ITEMS_TABLE,
        input.listId ? { list_id: input.listId } : { org_id: ctx.orgId },
      );
      return rows.map(toItem);
    },

    async addItem(input, ctx) {
      // org_id is the LIST's org (read under RLS — an unreadable list is "not
      // found"); the composite FK (list_id, org_id) requires exactly that.
      const [list] = await db.select(LISTS_TABLE, { id: input.listId });
      if (!list) throw new Error("shopping: listNotFound");
      const id = safeRandomUUID();
      const now = new Date().toISOString();
      await db.insert(ITEMS_TABLE, {
        id,
        owner_id: ctx.userId,
        org_id: String(list.org_id),
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
