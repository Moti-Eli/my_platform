/**
 * Inventory acceptance smoke — proves the whole platform mechanism end-to-end on
 * minimal content, with no browser and no live DB (in-memory CortexDb):
 *
 *   1. register the Inventory tool;
 *   2. add a product via runIntent('inventory.add_product');
 *   3. update its quantity BELOW the reorder threshold via
 *      runIntent('inventory.update_quantity');
 *   4. assert an 'inventory.low' row landed in the `events` table, and that
 *      `ai_log` rows were written (one per runIntent) — the audit trail.
 *
 * Run:  pnpm --filter @platform/cortex smoke:inventory
 * Exits non-zero on any failed assertion.
 */
import {
  createInMemoryDb,
  createDataLayer,
  createEventBus,
  registerApp,
  clearRegistry,
  type DbRow,
} from "@platform/cortex-core";
import { manifest } from "../manifest";
import { createInventoryLogic } from "../logic";
import { createInventoryIntents } from "../intents";
import { listeners } from "../events";
import { DEV_CTX } from "../../../cortex/dev-ctx";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    console.error(`  ✗ ${message}`);
    throw new Error(`Inventory smoke assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function main(): Promise<void> {
  console.log("Inventory smoke test\n");
  clearRegistry();

  // --- wire the core to an in-memory db (same as the browser runtime) --------
  const db = createInMemoryDb();
  const { runIntent } = createDataLayer({ db });
  const eventBus = createEventBus(db);
  const logic = createInventoryLogic({ db, emit: eventBus.emit });
  registerApp(manifest, createInventoryIntents(logic), listeners);
  console.log("Registered 'inventory' (3 intents).\n");

  // --- 2. add a product (above threshold) ------------------------------------
  console.log("runIntent('inventory.add_product', tomatoes qty 20, threshold 10):");
  const added = await runIntent<{ id: string }>(
    "inventory.add_product",
    { name: "tomatoes", quantity: 20, unit: "kg", reorderThreshold: 10 },
    DEV_CTX,
  );
  assert(typeof added.id === "string" && added.id.length > 0, "add_product returned an id");

  // --- 3. update below threshold ---------------------------------------------
  console.log("\nrunIntent('inventory.update_quantity', tomatoes setTo 5):");
  const updated = await runIntent<{ name: string; quantity: number }>(
    "inventory.update_quantity",
    { product: "tomatoes", setTo: 5 },
    DEV_CTX,
  );
  assert(updated.quantity === 5, "update_quantity returned the new quantity (5)");

  // --- 4a. an 'inventory.low' event persisted --------------------------------
  console.log("\nevents table:");
  const events = db.rows("events");
  const low = events.find((row: DbRow) => row.type === "inventory.low");
  assert(low !== undefined, "an 'inventory.low' row landed in the events table");
  const payload = (low?.payload ?? {}) as Record<string, unknown>;
  assert(payload.product === "tomatoes", "low event names the product");
  assert(payload.quantity === 5 && payload.threshold === 10, "low event carries quantity + threshold");
  assert(
    events.some((row: DbRow) => row.type === "inventory.updated"),
    "an 'inventory.updated' row was also persisted",
  );

  // --- 4b. ai_log audit rows written (one per runIntent) ---------------------
  console.log("\nai_log table:");
  const aiLog = db.rows("ai_log");
  assert(
    aiLog.some((row: DbRow) => row.intent === "inventory.add_product"),
    "ai_log recorded the add_product call",
  );
  assert(
    aiLog.some((row: DbRow) => row.intent === "inventory.update_quantity"),
    "ai_log recorded the update_quantity call",
  );

  console.log("\n✅ Inventory smoke passed — runIntent + event-bus + audit all work.");
}

main().catch((err) => {
  console.error("\n❌ Inventory smoke FAILED\n", err);
  process.exit(1);
});
