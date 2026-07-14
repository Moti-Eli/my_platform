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
import { createInventoryLogic, type AddProductInput } from "@/tools/inventory/logic";
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

// DEV ONLY — seed ~40 demo grocery/stock items so Home/full-screen show real
// content. Units vary (kg / pcs / L); ~7 sit below their reorder threshold so
// the low-stock count is meaningful. Everything goes through the normal
// add_product intent — no parallel data source.
const DEMO_ITEMS: AddProductInput[] = [
  { name: "עגבניות", quantity: 3, unit: "kg", reorderThreshold: 10 }, // low
  { name: "מלפפונים", quantity: 18, unit: "kg", reorderThreshold: 8 },
  { name: "גזר", quantity: 22, unit: "kg", reorderThreshold: 10 },
  { name: "בצל", quantity: 30, unit: "kg", reorderThreshold: 12 },
  { name: "תפוחי אדמה", quantity: 45, unit: "kg", reorderThreshold: 20 },
  { name: "חסה", quantity: 14, unit: "pcs", reorderThreshold: 10 },
  { name: "פלפל אדום", quantity: 6, unit: "kg", reorderThreshold: 8 }, // low
  { name: "פלפל ירוק", quantity: 11, unit: "kg", reorderThreshold: 6 },
  { name: "קישואים", quantity: 9, unit: "kg", reorderThreshold: 6 },
  { name: "חציל", quantity: 7, unit: "kg", reorderThreshold: 5 },
  { name: "בננות", quantity: 16, unit: "kg", reorderThreshold: 10 },
  { name: "תפוחים", quantity: 28, unit: "kg", reorderThreshold: 12 },
  { name: "תפוזים", quantity: 34, unit: "kg", reorderThreshold: 15 },
  { name: "לימונים", quantity: 13, unit: "kg", reorderThreshold: 6 },
  { name: "אבטיח", quantity: 5, unit: "pcs", reorderThreshold: 8 }, // low
  { name: "ענבים", quantity: 4, unit: "kg", reorderThreshold: 10 }, // low
  { name: "חלב", quantity: 24, unit: "L", reorderThreshold: 12 },
  { name: "שמנת", quantity: 9, unit: "L", reorderThreshold: 6 },
  { name: "יוגורט", quantity: 40, unit: "pcs", reorderThreshold: 20 },
  { name: "גבינה צהובה", quantity: 8, unit: "kg", reorderThreshold: 5 },
  { name: "גבינה לבנה", quantity: 26, unit: "pcs", reorderThreshold: 15 },
  { name: "חמאה", quantity: 10, unit: "pcs", reorderThreshold: 8 },
  { name: "ביצים", quantity: 8, unit: "pcs", reorderThreshold: 12 }, // low
  { name: "לחם אחיד", quantity: 22, unit: "pcs", reorderThreshold: 15 },
  { name: "לחמניות", quantity: 35, unit: "pcs", reorderThreshold: 20 },
  { name: "פיתות", quantity: 18, unit: "pcs", reorderThreshold: 12 },
  { name: "אורז", quantity: 50, unit: "kg", reorderThreshold: 20 },
  { name: "פסטה", quantity: 44, unit: "pcs", reorderThreshold: 18 },
  { name: "קמח", quantity: 33, unit: "kg", reorderThreshold: 15 },
  { name: "סוכר", quantity: 27, unit: "kg", reorderThreshold: 12 },
  { name: "מלח", quantity: 19, unit: "kg", reorderThreshold: 8 },
  { name: "שמן זית", quantity: 12, unit: "L", reorderThreshold: 6 },
  { name: "שמן קנולה", quantity: 7, unit: "L", reorderThreshold: 8 }, // low
  { name: "קפה", quantity: 5, unit: "kg", reorderThreshold: 4 },
  { name: "תה", quantity: 30, unit: "pcs", reorderThreshold: 15 },
  { name: "מים מינרלים", quantity: 60, unit: "L", reorderThreshold: 30 },
  { name: "משקאות קלים", quantity: 23, unit: "L", reorderThreshold: 20 },
  { name: "עוף", quantity: 14, unit: "kg", reorderThreshold: 10 },
  { name: "בשר טחון", quantity: 6, unit: "kg", reorderThreshold: 8 }, // low
  { name: "דגים", quantity: 9, unit: "kg", reorderThreshold: 6 },
];

async function seed(rt: Runtime): Promise<void> {
  const existing = await rt.runIntent<unknown[]>("inventory.query_stock", {}, DEV_CTX);
  if (existing.length > 0) return;
  for (const item of DEMO_ITEMS) {
    await rt.runIntent("inventory.add_product", item, DEV_CTX);
  }
}

/** Lazily build + seed the runtime once, then reuse it. */
export function getRuntime(): Promise<Runtime> {
  if (!runtime) runtime = build();
  const rt = runtime;
  if (!ready) ready = seed(rt).then(() => rt);
  return ready;
}
