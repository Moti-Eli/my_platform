/**
 * @platform/cortex-core
 *
 * The Cortex super-app *core*: a thin, business-logic-free engine that hosts
 * tools. It exposes four things (Cortex-SubApp-Standard.md §1, §6, §7):
 *
 *   - the shared contract types (Ctx, AppManifest, Intent, Listener);
 *   - the registry   — where tools register manifests/intents/listeners;
 *   - the data-layer — `runIntent`, the ONE door for all tool reads/writes;
 *   - the event-bus  — `emit`, decoupled fire-and-forget chain reactions.
 *
 * There are no sub-apps and no UI here yet — see the smoke demo in
 * `src/__demo__/smoke.ts` for the engine proven end-to-end.
 */

export const cortexCoreVersion = "0.1.0";

// --- Contract types (Standard §1) -------------------------------------------
export type {
  Ctx,
  LocalizedKey,
  AppManifest,
  AppStatus,
  Intent,
  Listener,
  AnyIntent,
  AnyListener,
} from "./types";

// --- Registry (task 3) ------------------------------------------------------
export {
  registerApp,
  getIntent,
  getApp,
  listApps,
  listIntents,
  getListeners,
  clearRegistry,
  appIdOf,
} from "./registry";
export type { RegisteredApp } from "./registry";

// --- Tool authoring helpers (Standard §4, §5) -------------------------------
export { defineIntent, defineListener } from "./define";

// --- Data-layer / runIntent (Standard §7, task 4) ---------------------------
export {
  createDataLayer,
  defaultAssertPermissions,
  IntentNotFoundError,
  PermissionDeniedError,
} from "./data-layer";
export type { DataLayer, DataLayerOptions, PermissionChecker } from "./data-layer";

// --- Event-bus (task 5) -----------------------------------------------------
export { createEventBus } from "./event-bus";
export type { EventBus } from "./event-bus";

// --- Database port (the "provided db client" of §7) -------------------------
export { createInMemoryDb } from "./db";
export type { CortexDb, InMemoryDb, DbRow, DbMatch } from "./db";
