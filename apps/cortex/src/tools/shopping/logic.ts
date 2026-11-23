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
 * (list_id, org_id) requires it). Nothing reads "the active org's list" any
 * more — the Home card shows "My lists" too.
 */
import { safeRandomUUID, type Ctx, type CortexDb, type DbRow } from "@platform/cortex-core";

export const LISTS_TABLE = "shopping_lists";
export const ITEMS_TABLE = "shopping_list_items";
// Personal list types (migration 20261123000001) — owner-only, no org_id.
export const TYPES_TABLE = "shopping_list_types";
export const TYPE_LINKS_TABLE = "shopping_list_type_links";

/** Mirrors shopping_list_types.name CHECK (1–40 after trimming). */
export const TYPE_NAME_MAX = 40;

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

/** One of the user's OWN list types: a name and a colour TOKEN name. */
export interface ListType {
  id: string;
  name: string;
  /** An accent token name (amber, green…); the screen maps unknown ones to neutral. */
  color: string;
  position: number;
}

/**
 * The user's types and which type each of their lists carries. `available`
 * is false while the types tables are not in the database yet — the screens
 * then show the lists without types instead of failing.
 */
export interface ListTypes {
  available: boolean;
  types: ListType[];
  /** listId → typeId (only the lists that have one). */
  links: Record<string, string>;
}

export interface CreateTypeInput {
  name: string;
  color: string;
}
/** typeId null = the list has no type (for this user). */
export interface SetListTypeInput {
  listId: string;
  typeId: string | null;
}

export interface GetListInput {
  id: string;
}
export interface ListItemsInput {
  listId: string;
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
  /** One list by id; null when the user cannot read it. */
  getList(input: GetListInput, ctx: Ctx): Promise<List | null>;
  createList(input: CreateListInput, ctx: Ctx): Promise<CreateListResult>;
  renameList(input: RenameListInput, ctx: Ctx): Promise<{ id: string }>;
  deleteList(input: DeleteListInput, ctx: Ctx): Promise<DeleteListResult>;
  /** One list's items. */
  listItems(input: ListItemsInput, ctx: Ctx): Promise<Item[]>;
  addItem(input: AddItemInput, ctx: Ctx): Promise<{ id: string; createdAt: string }>;
  updateItem(input: UpdateItemInput, ctx: Ctx): Promise<{ id: string }>;
  setChecked(input: SetCheckedInput, ctx: Ctx): Promise<{ id: string }>;
  deleteItem(input: DeleteItemInput, ctx: Ctx): Promise<{ id: string }>;

  /** The user's own types + their list→type links; `available` false when the
   *  tables are not migrated yet. */
  listTypes(input: Record<string, never>, ctx: Ctx): Promise<ListTypes>;
  createType(input: CreateTypeInput, ctx: Ctx): Promise<ListType>;
  setListType(input: SetListTypeInput, ctx: Ctx): Promise<{ listId: string }>;
}

/** PostgREST / Postgres wording for "this table does not exist (yet)". */
function isMissingTable(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /could not find the table|schema cache|relation .* does not exist/i.test(message);
}

function toType(row: DbRow): ListType {
  return {
    id: String(row.id),
    name: String(row.name),
    color: String(row.color),
    position: Number(row.position ?? 0),
  };
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

    async getList(input, _ctx) {
      const [row] = await db.select(LISTS_TABLE, { id: input.id });
      return row ? toList(row) : null;
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

    async listItems(input, _ctx) {
      const rows = await db.select(ITEMS_TABLE, { list_id: input.listId });
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

    // --- personal list types (stage 2) ---------------------------------------
    // Owner-only RLS on both tables; the owner_id filters below are context.
    async listTypes(_input, ctx) {
      try {
        const types = (await db.select(TYPES_TABLE, { owner_id: ctx.userId }))
          .map(toType)
          .sort((a, b) => a.position - b.position);
        const links: Record<string, string> = {};
        for (const row of await db.select(TYPE_LINKS_TABLE, { owner_id: ctx.userId })) {
          links[String(row.list_id)] = String(row.type_id);
        }
        return { available: true, types, links };
      } catch (err) {
        // Not migrated yet: the screens show plain lists instead of failing.
        if (isMissingTable(err)) return { available: false, types: [], links: {} };
        throw err;
      }
    },

    async createType(input, ctx) {
      // Appended after the user's last type. A duplicate name is refused by the
      // DB (unique per user, ignoring case); the screen checks first.
      const existing = await db.select(TYPES_TABLE, { owner_id: ctx.userId });
      const position = existing.reduce((max, r) => Math.max(max, Number(r.position ?? 0) + 1), 0);
      const id = safeRandomUUID();
      await db.insert(TYPES_TABLE, {
        id,
        owner_id: ctx.userId,
        name: input.name,
        color: input.color,
        position,
      });
      return { id, name: input.name, color: input.color, position };
    },

    async setListType(input, ctx) {
      // One link per (user, list): none → delete; else update or insert. The
      // INSERT policy also requires the list to be readable by the user.
      const match = { owner_id: ctx.userId, list_id: input.listId };
      const [existing] = await db.select(TYPE_LINKS_TABLE, match);
      if (input.typeId === null) {
        if (existing) await db.delete(TYPE_LINKS_TABLE, match);
      } else if (existing) {
        await db.update(TYPE_LINKS_TABLE, match, {
          type_id: input.typeId,
          updated_at: new Date().toISOString(),
        });
      } else {
        await db.insert(TYPE_LINKS_TABLE, { ...match, type_id: input.typeId });
      }
      return { listId: input.listId };
    },
  };
}
