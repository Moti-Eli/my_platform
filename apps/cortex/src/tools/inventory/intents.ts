/**
 * Inventory — the AI API ("the connection file", Standard §4).
 *
 * The AI never sees a table; it sees this list of actions and their zod schemas.
 * Handlers delegate to `logic` (which is the only code that touches the db
 * client / emits events) and receive `ctx` from the shell — they never fetch it
 * or write SQL themselves. Every name is `inventory.<action>`.
 *
 * NOTE (injected, not singleton): `logic` needs the db client + event-bus, which
 * are created at runtime, so intents are produced by `createInventoryIntents(logic)`
 * rather than importing a global `inventoryLogic` singleton. Same shapes as §4,
 * dependencies injected instead of global.
 */
import { z } from "zod";
import { defineIntent } from "@platform/cortex-core";
import type { InventoryLogic } from "./logic";

/** One inventory line as returned to the AI/views. Enriched beyond the §4 example
 * with `id` + `reorderThreshold` because the required views (low-stock card,
 * inline quantity update) need them. */
const stockItem = z.object({
  id: z.string(),
  name: z.string(),
  quantity: z.number(),
  unit: z.string(),
  reorderThreshold: z.number(),
});

export function createInventoryIntents(logic: InventoryLogic) {
  return [
    defineIntent({
      name: "inventory.query_stock",
      description: "How much of a given product, or of all products, is left",
      input: z.object({ product: z.string().optional() }),
      output: z.array(stockItem),
      handler: (input, ctx) => logic.queryStock(input, ctx),
    }),

    defineIntent({
      name: "inventory.update_quantity",
      description: "Update a product quantity (add / subtract / set)",
      input: z.object({
        product: z.string(),
        delta: z.number().optional(),
        setTo: z.number().optional(),
      }),
      output: z.object({ name: z.string(), quantity: z.number() }),
      // → may emit inventory.updated / inventory.low (see logic + events.ts)
      handler: (input, ctx) => logic.updateQuantity(input, ctx),
    }),

    defineIntent({
      name: "inventory.add_product",
      description: "Add a new product to inventory",
      input: z.object({
        name: z.string(),
        quantity: z.number(),
        unit: z.string(),
        reorderThreshold: z.number(),
      }),
      output: z.object({ id: z.string() }),
      handler: (input, ctx) => logic.addProduct(input, ctx),
    }),
  ];
}
