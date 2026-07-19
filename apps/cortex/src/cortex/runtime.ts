/**
 * Cortex client runtime — wires the core to the registered tools.
 *
 * This is the CLIENT composition root, and its ONE job now is REGISTRATION: it
 * builds a runtime and registers every tool (real + stub) so the chips row, the
 * catalog and the app shell can list what exists. It runs on the client, on every
 * screen including /login, and must never need a session.
 *
 * IT NO LONGER READS OR WRITES TOOL DATA. That moved to the server: intents run
 * through `runIntentAction` (`@/cortex/actions`) → the server data-layer on the
 * Supabase-backed `CortexDb`, because the grants (20260717000001/2) revoked client
 * writes on every Cortex table and reads must carry the user's JWT so RLS runs.
 * The views call the action; they no longer touch this runtime for data.
 *
 * The in-memory `CortexDb` below is now used ONLY to satisfy the data-layer/
 * event-bus constructors during registration — nothing reads from it, and the
 * demo seed that used to fill it is gone (rows live in Postgres now). Registration
 * does not need a real backend, so this stays a dependency-free client concern.
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
import { manifest as tasksManifest } from "@/tools/tasks/manifest";
import { createTasksLogic } from "@/tools/tasks/logic";
import { createTasksIntents } from "@/tools/tasks/intents";
import { listeners as tasksListeners } from "@/tools/tasks/events";
import { manifest as staffManifest } from "@/tools/staff/manifest";
import { createStaffLogic } from "@/tools/staff/logic";
import { createStaffIntents } from "@/tools/staff/intents";
import { listeners as staffListeners } from "@/tools/staff/events";
import { STUB_APPS } from "@/tools/stub-apps";

export interface Runtime {
  db: InMemoryDb;
  runIntent: DataLayer["runIntent"];
  emit: EventBus["emit"];
}

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
  const tasksLogic = createTasksLogic({ db, emit: eventBus.emit });
  if (!getApp(tasksManifest.id)) {
    registerApp(tasksManifest, createTasksIntents(tasksLogic), tasksListeners);
  }
  // Staff's read runs SERVER-SIDE ONLY (through runIntentAction → the server
  // data-layer). This client runtime registers the tool so the catalog/chips can
  // LIST it, but never invokes its intent — so it never needs a real RLS client.
  // The stub throws if ever called, which client-side it is not.
  const staffLogic = createStaffLogic({
    getRls: () => {
      throw new Error("staff.list_members runs server-side only");
    },
  });
  if (!getApp(staffManifest.id)) {
    registerApp(staffManifest, createStaffIntents(staffLogic), staffListeners);
  }

  // TEMP: register the placeholder apps as real registry entries (no intents),
  // so chips/Home/catalog read a SINGLE source of truth. Replace with real
  // manifests as tools are built.
  for (const stub of STUB_APPS) {
    if (!getApp(stub.id)) registerApp(stub);
  }

  return { db, runIntent: dataLayer.runIntent, emit: eventBus.emit };
}

/**
 * Lazily build the runtime once (registering every tool), then reuse it.
 *
 * TAKES NO ctx, DELIBERATELY. Registration is not a privileged act: it lists what
 * tools EXIST, not anyone's data. The chips row, the catalog and the app shell all
 * need that list, and the shell renders on /login too — where there is no session
 * and never will be. Requiring identity here would mean either breaking the login
 * page or inventing a fake ctx to get past it, and inventing a fake ctx is the
 * habit this whole step exists to end. Data (reads/writes) does need identity, and
 * it runs through `runIntentAction` on the server — never here.
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
