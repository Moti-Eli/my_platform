/**
 * Shopping — the AI API ("the connection file", Standard §4).
 *
 * Handlers delegate to `logic` and receive `ctx` from the shell. Every name is
 * `shopping.<action>`. Length caps mirror the table CHECK constraints.
 */
import { z } from "zod";
import { defineIntent } from "@platform/cortex-core";
import { ITEM_NAME_MAX, LIST_NAME_MAX, QUANTITY_MAX, type ShoppingLogic } from "./logic";

const list = z.object({ id: z.string(), name: z.string() });
const item = z.object({
  id: z.string(),
  name: z.string(),
  quantity: z.string(),
  checked: z.boolean(),
  createdAt: z.string(),
});
const itemName = z.string().trim().min(1).max(ITEM_NAME_MAX);
const quantity = z.string().trim().max(QUANTITY_MAX);
const id = z.object({ id: z.string() });

export function createShoppingIntents(logic: ShoppingLogic) {
  return [
    // READ. The active org's list — null when the active org is not a list org.
    defineIntent({
      name: "shopping.get_list",
      description: "Get the shopping list of the current organization, or null if it has none",
      input: z.object({}),
      output: list.nullable(),
      handler: (input, ctx) => logic.getList(input, ctx),
    }),
    // Creates the list's own root organization, installs this tool there and
    // inserts the list. The caller then switches to the returned org.
    defineIntent({
      name: "shopping.create_list",
      description:
        "Create a new shopping list (home, office, event…) in its own small organization and return the list and organization ids",
      input: z.object({ name: z.string().trim().min(1).max(LIST_NAME_MAX) }),
      output: z.object({ listId: z.string(), orgId: z.string() }),
      handler: (input, ctx) => logic.createList(input, ctx),
    }),

    // --- items ----------------------------------------------------------------
    defineIntent({
      name: "shopping.list_items",
      description: "List the items on the current organization's shopping list",
      input: z.object({}),
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
  ];
}
