/**
 * Shopping — the AI API ("the connection file", Standard §4).
 *
 * Handlers delegate to `logic` and receive `ctx` from the shell. Every name is
 * `shopping.<action>`. Length caps mirror the table CHECK constraints.
 */
import { z } from "zod";
import { defineIntent } from "@platform/cortex-core";
import { LIST_NAME_MAX, type ShoppingLogic } from "./logic";

export function createShoppingIntents(logic: ShoppingLogic) {
  return [
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
