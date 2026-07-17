/**
 * Cortex client runtime — wires the core to the registered tools.
 *
 * This is the shell's composition root: it builds the data-layer (`runIntent`,
 * the one door), the event-bus (`emit`), and a db client, constructs each tool's
 * logic + intents, and registers the tools. Views call `getRuntime(ctx)` then
 * `runIntent(...)` with that same shell-provided `ctx`.
 *
 * WHY getRuntime TAKES A ctx — the demo seed writes through the normal
 * `add_product` intent, so its rows carry `org_id = ctx.orgId`, and `query_stock`
 * filters by `org_id`. Seeding under any other identity than the one the views
 * read with would write ~40 rows into an org nobody is looking at: every screen
 * would render EMPTY, silently, looking exactly like "auth broke the app". The
 * seed must run as the signed-in user, so the composition root needs the session.
 *
 * DEV ONLY (data backend): the db is still the in-memory adapter — the SAME
 * `CortexDb` port a Supabase adapter will implement, so `runIntent`/`emit`/
 * `ai_log`/`events` all exercise the real mechanism. Swap `createInMemoryDb()`
 * for a Supabase-backed `CortexDb` next; nothing else here changes. Note the
 * memo below is per-tab, so the seed re-runs per session — which is correct while
 * the store is in memory and disappears with the tab.
 */
import {
  createInMemoryDb,
  createDataLayer,
  createEventBus,
  registerApp,
  getApp,
  type Ctx,
  type InMemoryDb,
  type DataLayer,
  type EventBus,
} from "@platform/cortex-core";
import { manifest } from "@/tools/inventory/manifest";
import { createInventoryLogic, type AddProductInput } from "@/tools/inventory/logic";
import { createInventoryIntents } from "@/tools/inventory/intents";
import { listeners } from "@/tools/inventory/events";
import { STUB_APPS } from "@/tools/stub-apps";

export interface Runtime {
  db: InMemoryDb;
  runIntent: DataLayer["runIntent"];
  emit: EventBus["emit"];
}

let ready: Promise<Runtime> | null = null;
let seeded: Promise<Runtime> | null = null;

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

async function seed(rt: Runtime, ctx: Ctx): Promise<void> {
  const existing = await rt.runIntent<unknown[]>("inventory.query_stock", {}, ctx);
  if (existing.length > 0) return;
  for (const item of DEMO_ITEMS) {
    await rt.runIntent("inventory.add_product", item, ctx);
  }
}

/**
 * Lazily build the runtime once (registering every tool), then reuse it.
 *
 * TAKES NO ctx, DELIBERATELY. Registration is not a privileged act: it lists what
 * tools EXIST, not anyone's data. The chips row, the catalog and the app shell all
 * need that list, and the shell renders on /login too — where there is no session
 * and never will be. Requiring identity here would mean either breaking the login
 * page or inventing a fake ctx to get past it, and inventing a fake ctx is the
 * habit this whole step exists to end. Seeding — which DOES write data and so DOES
 * need identity — is a separate call: {@link getSeededRuntime}.
 */
export function getRuntime(): Promise<Runtime> {
  if (ready) return ready;

  // Build synchronously *inside* the promise so a registration failure becomes a
  // REJECTED promise, never a synchronous throw — otherwise `getRuntime().catch()`
  // at a call site can't attach in time and the failure escapes unlogged. This is
  // the swallow that hid the non-secure-origin crypto throw for so long.
  ready = (async (): Promise<Runtime> => build())().catch((err: unknown) => {
    // Registration is the app's foundation — never let a failure here vanish
    // silently. Log clearly, drop the memo so the next call retries, then
    // re-reject so callers' own `.catch` handlers also see it.
    console.error("Cortex runtime: init/registration failed", err);
    ready = null;
    throw err;
  });

  return ready;
}

/**
 * The runtime, with the DEV demo data seeded AS THE SIGNED-IN USER.
 *
 * Any view that reads or writes tool data calls this, passing the ctx built from
 * its page's `requireSession()` result. The seed runs through the normal
 * `add_product` intent, so its rows carry `org_id = ctx.orgId` — the same org
 * `query_stock` then filters on. Seeding under any other identity would file ~40
 * rows in an org nobody is reading, and every screen would render empty.
 */
export function getSeededRuntime(ctx: Ctx): Promise<Runtime> {
  if (seeded) return seeded;

  seeded = (async (): Promise<Runtime> => {
    const rt = await getRuntime();
    // Seeding is best-effort demo data; the apps are already registered, so a
    // seed failure must NOT take down the runtime (the registry-backed
    // catalog/chips must still work). Log loudly instead of swallowing.
    await seed(rt, ctx).catch((err: unknown) => {
      console.error("Cortex runtime: inventory seed failed", err);
    });
    return rt;
  })().catch((err: unknown) => {
    console.error("Cortex runtime: seeded-runtime init failed", err);
    seeded = null;
    throw err;
  });

  return seeded;
}
