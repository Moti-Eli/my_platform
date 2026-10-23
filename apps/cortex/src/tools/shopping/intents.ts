/**
 * Shopping — the AI API ("the connection file", Standard §4).
 *
 * Handlers delegate to `logic` and receive `ctx` from the shell. Every name is
 * `shopping.<action>`. Length caps mirror the table CHECK constraints.
 */
import { z } from "zod";
import { defineIntent } from "@platform/cortex-core";
import { LIST_NAME_MAX, type ShoppingLogic } from "./logic";

const list = z.object({ id: z.string(), name: z.string() });

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
  ];
}
