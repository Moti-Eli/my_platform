/**
 * Shopping — the AI API ("the connection file", Standard §4).
 *
 * Handlers delegate to `logic` and receive `ctx` from the shell. Every name is
 * `shopping.<action>`. Length caps mirror the table CHECK constraints.
 */
import { z } from "zod";
import { defineIntent } from "@platform/cortex-core";
import { ITEM_NAME_MAX, LIST_NAME_MAX, QUANTITY_MAX, TYPE_NAME_MAX, type ShoppingLogic } from "./logic";

const list = z.object({ id: z.string(), name: z.string(), orgId: z.string() });
const listSummary = list.extend({ toBuy: z.number(), total: z.number() });
const item = z.object({
  id: z.string(),
  name: z.string(),
  quantity: z.string(),
  checked: z.boolean(),
  createdAt: z.string(),
});
const itemName = z.string().trim().min(1).max(ITEM_NAME_MAX);
const listType = z.object({ id: z.string(), name: z.string(), color: z.string(), position: z.number() });
/** A design-system accent token NAME (mirrors the DB CHECK), never a colour value. */
const colorToken = z.string().regex(/^[a-z]{2,20}$/);
const quantity = z.string().trim().max(QUANTITY_MAX);
const id = z.object({ id: z.string() });

export function createShoppingIntents(logic: ShoppingLogic) {
  return [
    // READ. Every list the user can read, across all their organizations.
    defineIntent({
      name: "shopping.list_lists",
      description:
        "List all of the user's shopping lists (created or shared with them), with how many items are left to buy",
      input: z.object({}),
      output: z.array(listSummary),
      handler: (input, ctx) => logic.listLists(input, ctx),
    }),
    // READ. One list by id (null when the user cannot read it).
    defineIntent({
      name: "shopping.get_list",
      description: "Get one of the user's shopping lists by id",
      input: z.object({ id: z.string().min(1) }),
      output: list.nullable(),
      handler: (input, ctx) => logic.getList(input, ctx),
    }),
    // Creates the list's own root organization, installs this tool there and
    // inserts the list. The screen then opens it in place (no org switch).
    defineIntent({
      name: "shopping.create_list",
      description:
        "Create a new shopping list (home, office, event…) in its own small organization and return the list and organization ids",
      input: z.object({ name: z.string().trim().min(1).max(LIST_NAME_MAX) }),
      output: z.object({ listId: z.string(), orgId: z.string() }),
      handler: (input, ctx) => logic.createList(input, ctx),
    }),

    defineIntent({
      name: "shopping.rename_list",
      description: "Rename the shopping list (the list's name only)",
      input: z.object({ id: z.string(), name: z.string().trim().min(1).max(LIST_NAME_MAX) }),
      output: id,
      handler: (input, ctx) => logic.renameList(input, ctx),
    }),
    // Deletes the list and its items, then hides its org. Refused — with the
    // list left intact — when the org is the user's last or has other members.
    defineIntent({
      name: "shopping.delete_list",
      description: "Delete the shopping list with all its items and hide its organization",
      input: id,
      output: z.union([
        z.object({ deleted: z.literal(true) }),
        z.object({ error: z.enum(["lastOrg", "otherMembers", "hideFailed"]) }),
      ]),
      handler: (input, ctx) => logic.deleteList(input, ctx),
    }),

    // --- items ----------------------------------------------------------------
    defineIntent({
      name: "shopping.list_items",
      description: "List the items on one shopping list (by listId)",
      input: z.object({ listId: z.string().min(1) }),
      output: z.array(item),
      handler: (input, ctx) => logic.listItems(input, ctx),
    }),
    defineIntent({
      name: "shopping.add_item",
      description: "Add an item (name and optional free-text quantity) to the shopping list",
      input: z.object({ listId: z.string(), name: itemName, quantity }),
      output: z.object({ id: z.string(), createdAt: z.string() }),
      handler: (input, ctx) => logic.addItem(input, ctx),
    }),
    defineIntent({
      name: "shopping.update_item",
      description: "Change an item's name and quantity",
      input: z.object({ id: z.string(), name: itemName, quantity }),
      output: id,
      handler: (input, ctx) => logic.updateItem(input, ctx),
    }),
    defineIntent({
      name: "shopping.set_checked",
      description: "Check an item off as bought, or uncheck it",
      input: z.object({ id: z.string(), checked: z.boolean() }),
      output: id,
      handler: (input, ctx) => logic.setChecked(input, ctx),
    }),
    defineIntent({
      name: "shopping.delete_item",
      description: "Delete an item from the shopping list",
      input: id,
      output: id,
      handler: (input, ctx) => logic.deleteItem(input, ctx),
    }),

    // --- personal list types --------------------------------------------------
    defineIntent({
      name: "shopping.list_types",
      description:
        "The user's own list types (name and colour) and which type each of their lists carries",
      input: z.object({}),
      output: z.object({
        available: z.boolean(),
        types: z.array(listType),
        links: z.record(z.string(), z.string()),
      }),
      handler: (input, ctx) => logic.listTypes(input, ctx),
    }),
    defineIntent({
      name: "shopping.create_type",
      description: "Create one of the user's own list types (home, work…) with a colour",
      input: z.object({ name: z.string().trim().min(1).max(TYPE_NAME_MAX), color: colorToken }),
      output: listType,
      handler: (input, ctx) => logic.createType(input, ctx),
    }),
    defineIntent({
      name: "shopping.set_list_type",
      description: "Give one of the user's lists one of their types, or none (typeId null)",
      input: z.object({ listId: z.string().min(1), typeId: z.string().min(1).nullable() }),
      output: z.object({ listId: z.string() }),
      handler: (input, ctx) => logic.setListType(input, ctx),
    }),
  ];
}
