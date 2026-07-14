/**
 * Cortex client runtime — wires the core to the registered tools.
 *
 * This is the shell's composition root: it builds the data-layer (`runIntent`,
 * the one door), the event-bus (`emit`), and a db client, constructs each tool's
 * logic + intents, and registers the tools. Views call `getRuntime()` then
 * `runIntent(...)` with the shell-provided `ctx` (the DEV ctx for now).
 *
 * DEV ONLY (data backend): until Cortex auth + Supabase are wired, the db is the
 * in-memory adapter — the SAME `CortexDb` port a Supabase adapter will implement,
 * so `runIntent`/`emit`/`ai_log`/`events` all exercise the real mechanism. Swap
 * `createInMemoryDb()` for a Supabase-backed `CortexDb` when auth lands; nothing
 * else here changes.
 */
import {
  createInMemoryDb,
  createDataLayer,
  createEventBus,
  registerApp,
  getApp,
  type InMemoryDb,
  type DataLayer,
  type EventBus,
} from "@platform/cortex-core";
import { manifest } from "@/tools/inventory/manifest";
import { createInventoryLogic } from "@/tools/inventory/logic";
import { createInventoryIntents } from "@/tools/inventory/intents";
import { listeners } from "@/tools/inventory/events";
import { STUB_APPS } from "@/tools/stub-apps";
import { DEV_CTX } from "./dev-ctx";

export interface Runtime {
  db: InMemoryDb;
  runIntent: DataLayer["runIntent"];
  emit: EventBus["emit"];
}

let runtime: Runtime | null = null;
let ready: Promise<Runtime> | null = null;

function build(): Runtime {
  const db = createInMemoryDb();
  const dataLayer = createDataLayer({ db });
  const eventBus = createEventBus(db);

  // --- Register tools (Standard §2/§3). Add future tools here. ---------------
  const inventoryLogic = createInventoryLogic({ db, emit: eventBus.emit });
  if (!getApp(manifest.id)) {
    registerApp(manifest, createInventoryIntents(inventoryLogic), listeners);
  }

  // TEMP: register the placeholder apps as real registry entries (no intents),
  // so chips/Home/catalog read a SINGLE source of truth. Replace with real
  // manifests as tools are built.
  for (const stub of STUB_APPS) {
    if (!getApp(stub.id)) registerApp(stub);
  }

  return { db, runIntent: dataLayer.runIntent, emit: eventBus.emit };
}

// DEV ONLY — seed a little inventory so Home/full-screen show content on first
// run (one item is intentionally below threshold to demonstrate the low card).
async function seed(rt: Runtime): Promise<void> {
  const existing = await rt.runIntent<unknown[]>("inventory.query_stock", {}, DEV_CTX);
  if (existing.length > 0) return;
  await rt.runIntent("inventory.add_product", { name: "עגבניות", quantity: 3, unit: "kg", reorderThreshold: 10 }, DEV_CTX);
  await rt.runIntent("inventory.add_product", { name: "חלב", quantity: 24, unit: "L", reorderThreshold: 12 }, DEV_CTX);
  await rt.runIntent("inventory.add_product", { name: "ביצים", quantity: 8, unit: "pcs", reorderThreshold: 12 }, DEV_CTX);
}

/** Lazily build + seed the runtime once, then reuse it. */
export function getRuntime(): Promise<Runtime> {
  if (!runtime) runtime = build();
  const rt = runtime;
  if (!ready) ready = seed(rt).then(() => rt);
  return ready;
}
