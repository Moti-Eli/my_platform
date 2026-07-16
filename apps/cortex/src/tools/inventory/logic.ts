/**
 * Inventory — internal business logic + event emission (Standard §2 `logic.ts`).
 *
 * Intent handlers delegate here; this is the ONLY place inventory touches its
 * data (through the provided `CortexDb` client — never raw SQL) and the ONLY
 * place it emits events (through the provided event-bus `emit`). It receives
 * `ctx` from the shell and never fetches identity itself. Every read/write is
 * scoped by `instance_id` (the tool instance) for isolation. The table's single
 * source of truth is the migration
 * `packages/db/supabase/migrations/20260716000002_cortex_org_tree_model.sql`,
 * which is now org-scoped and has NO `instance_id` column — reconciling this
 * file with that is known, deliberately deferred debt.
 */
import { safeRandomUUID, type Ctx, type CortexDb, type DbRow } from "@platform/cortex-core";

export const INVENTORY_TABLE = "inventory_items";

export interface InventoryItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  reorderThreshold: number;
}

export interface QueryStockInput {
  product?: string;
}
export interface UpdateQuantityInput {
  product: string;
  delta?: number;
  setTo?: number;
}
export interface AddProductInput {
  name: string;
  quantity: number;
  unit: string;
  reorderThreshold: number;
}

export interface InventoryLogic {
  queryStock(input: QueryStockInput, ctx: Ctx): Promise<InventoryItem[]>;
  updateQuantity(
    input: UpdateQuantityInput,
    ctx: Ctx,
  ): Promise<{ name: string; quantity: number }>;
  addProduct(input: AddProductInput, ctx: Ctx): Promise<{ id: string }>;
}

/** The event-bus surface the logic needs (from `@platform/cortex-core`). */
type Emit = (type: string, payload: unknown, ctx: Ctx) => Promise<void>;

/** Map a raw DB row to a typed item (the DB uses snake_case columns). */
function toItem(row: DbRow): InventoryItem {
  return {
    id: String(row.id),
    name: String(row.name),
    quantity: Number(row.quantity),
    unit: String(row.unit),
    reorderThreshold: Number(row.reorder_threshold),
  };
}

export function createInventoryLogic({ db, emit }: { db: CortexDb; emit: Emit }): InventoryLogic {
  return {
    async queryStock(input, ctx) {
      const rows = await db.select(INVENTORY_TABLE, { instance_id: ctx.instanceId });
      const items = rows.map(toItem);
      if (!input.product) return items;
      const needle = input.product.trim().toLowerCase();
      return items.filter((item) => item.name.toLowerCase().includes(needle));
    },

    async updateQuantity(input, ctx) {
      const rows = await db.select(INVENTORY_TABLE, {
        instance_id: ctx.instanceId,
        name: input.product,
      });
      const current = rows[0];
      if (!current) {
        throw new Error(`inventory: no product named '${input.product}'`);
      }
      const item = toItem(current);

      const nextQuantity =
        input.setTo !== undefined
          ? input.setTo
          : input.delta !== undefined
            ? item.quantity + input.delta
            : item.quantity;

      await db.update(
        INVENTORY_TABLE,
        { id: item.id },
        { quantity: nextQuantity, updated_at: new Date().toISOString() },
      );

      // Always announce the change; if it dropped below the reorder threshold,
      // fire the low-stock event too. The tool doesn't know who listens.
      await emit("inventory.updated", { product: item.name, quantity: nextQuantity }, ctx);
      if (nextQuantity < item.reorderThreshold) {
        await emit(
          "inventory.low",
          { product: item.name, quantity: nextQuantity, threshold: item.reorderThreshold },
          ctx,
        );
      }

      return { name: item.name, quantity: nextQuantity };
    },

    async addProduct(input, ctx) {
      const id = safeRandomUUID();
      const now = new Date().toISOString();
      await db.insert(INVENTORY_TABLE, {
        id,
        // the three mandatory fields (§6)
        instance_id: ctx.instanceId,
        owner_id: ctx.userId,
        org_id: ctx.orgId,
        // tool columns
        name: input.name,
        quantity: input.quantity,
        unit: input.unit,
        reorder_threshold: input.reorderThreshold,
        created_at: now,
        updated_at: now,
      });
      return { id };
    },
  };
}
