/**
 * Inventory — internal business logic + event emission (Standard §2 `logic.ts`).
 *
 * Intent handlers delegate here; this is the ONLY place inventory touches its
 * data (through the provided `CortexDb` client — never raw SQL) and the ONLY
 * place it emits events (through the provided event-bus `emit`). It receives
 * `ctx` from the shell and never fetches identity itself.
 *
 * SCOPED BY `org_id`, AND ONLY BY `org_id`. The table's single source of truth is
 * `packages/db/supabase/migrations/20260716000002_cortex_org_tree_model.sql`:
 * `owner_id NOT NULL`, `org_id NOT NULL`, `visibility` defaulting to 'org', and
 * NO `instance_id` column at all — tabs and branches are CHILD ORGANIZATIONS, not
 * instances. This file used to filter and write `instance_id` against a table
 * that no longer had it, and its header called reconciling the two deferred debt.
 * This is that reconciliation: the debt is paid, not deferred.
 *
 * NEXT DEBT, DELIBERATELY NOT THIS STEP'S JOB — `visibility` and grants. The
 * writes below do not set `visibility`; the column defaults to 'org', which is
 * the right default and the only behavior available today. Per the SubApp
 * Standard a manifest is supposed to declare `defaultVisibility` and
 * `defaultGrants`, and `shell.grant_access` (20260716000008) is the door that
 * would seed them at creation. The manifest declares NEITHER yet, so there is
 * nothing to honor and inventing it here would put tool-specific policy in the
 * wrong layer. Left as a clean seam.
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
      // A CONTEXT filter — "show me THIS org's inventory" — NOT a security filter.
      // The distinction matters, because this line looks exactly like a tool
      // guarding its own data and it is not doing that at all. Security lives in
      // the DATABASE: `private.auth_user_can_read` behind inventory_items' RLS
      // policy, which ANDs org-tree membership before anything else. Delete this
      // filter and nothing becomes insecure — RLS would still refuse every other
      // org's rows; the user would simply see every org they belong to at once,
      // mixed together, which is a UX bug, not a leak. A tool never decides who
      // may see a row at read time. The shell picks the org, RLS enforces it.
      const rows = await db.select(INVENTORY_TABLE, { org_id: ctx.orgId });
      const items = rows.map(toItem);
      if (!input.product) return items;
      const needle = input.product.trim().toLowerCase();
      return items.filter((item) => item.name.toLowerCase().includes(needle));
    },

    async updateQuantity(input, ctx) {
      // Same context filter as queryStock (see the note there): scope the lookup
      // to the active org, then find the product by name within it.
      const rows = await db.select(INVENTORY_TABLE, {
        org_id: ctx.orgId,
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
        // The mandatory fields (§6). Both are NOT NULL on the table; there is no
        // instance_id column to set. `visibility` is deliberately omitted — the
        // column defaults to 'org' (see the header's note on the manifest seam).
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
