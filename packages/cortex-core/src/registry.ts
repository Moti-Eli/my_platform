/**
 * The in-memory registry (Standard §1 laws 2 & 3; core prompt task 3).
 *
 * At startup every sub-app calls {@link registerApp} with its manifest, intents,
 * and event listeners. The shell then routes exclusively through this registry:
 * the data-layer resolves intents by name, and the event-bus resolves listeners
 * by event type. Tools never reference each other — the registry is the only
 * lookup surface, which is what keeps them independent units.
 *
 * This is process-local, in-memory state (there are no sub-apps yet). It is
 * rebuilt on each boot from the code that calls `registerApp`.
 */

import type { AppManifest, AnyIntent, AnyListener } from "./types";

/** A single registered tool and everything it contributed. */
export interface RegisteredApp {
  manifest: AppManifest;
  intents: AnyIntent[];
  listeners: AnyListener[];
}

const apps = new Map<string, RegisteredApp>();
/** Fast lookup: intent name -> intent. */
const intentsByName = new Map<string, AnyIntent>();
/** Fast lookup: event type -> the listeners subscribed to it. */
const listenersByType = new Map<string, AnyListener[]>();

/** The app id portion of an intent name (`<appId>.<action>` -> `<appId>`). */
export function appIdOf(intentName: string): string {
  const dot = intentName.indexOf(".");
  return dot === -1 ? intentName : intentName.slice(0, dot);
}

/**
 * Register a tool's manifest, intents, and listeners.
 *
 * Enforces the contract invariants (Standard §3, §7):
 *   - an app id is registered at most once;
 *   - every intent name is exactly `<manifest.id>.<action>`;
 *   - intent names are globally unique;
 *   - every manifest declares defaultVisibility ("org" | "private").
 *
 * @throws if any invariant is violated (fail fast at boot, not at call time).
 */
export function registerApp(
  manifest: AppManifest,
  intents: AnyIntent[] = [],
  listeners: AnyListener[] = [],
): void {
  if (apps.has(manifest.id)) {
    throw new Error(`Cortex registry: app '${manifest.id}' is already registered.`);
  }

  if (manifest.defaultVisibility !== "org" && manifest.defaultVisibility !== "private") {
    throw new Error(
      `Cortex registry: app '${manifest.id}' must declare defaultVisibility as ` +
        `"org" or "private" (got ${JSON.stringify(manifest.defaultVisibility)}).`,
    );
  }

  for (const intent of intents) {
    const owner = appIdOf(intent.name);
    if (owner !== manifest.id) {
      throw new Error(
        `Cortex registry: intent '${intent.name}' must be prefixed with its app id ` +
          `'${manifest.id}.' (got app '${owner}').`,
      );
    }
    if (intentsByName.has(intent.name)) {
      throw new Error(`Cortex registry: intent '${intent.name}' is already registered.`);
    }
  }

  // All checks passed — commit atomically so a rejected app leaves no partial state.
  apps.set(manifest.id, { manifest, intents, listeners });
  for (const intent of intents) {
    intentsByName.set(intent.name, intent);
  }
  for (const listener of listeners) {
    const list = listenersByType.get(listener.eventType) ?? [];
    list.push(listener);
    listenersByType.set(listener.eventType, list);
  }
}

/** Look up a registered intent by its `<appId>.<action>` name. */
export function getIntent(name: string): AnyIntent | undefined {
  return intentsByName.get(name);
}

/** Look up a registered app (and its manifest) by id. */
export function getApp(id: string): RegisteredApp | undefined {
  return apps.get(id);
}

/** Every registered app, in registration order (e.g. for the shell to render pinned tools). */
export function listApps(): RegisteredApp[] {
  return [...apps.values()];
}

/**
 * List available intents, optionally narrowed to a set of apps.
 *
 * The Standard sketches this as `listIntents(forInstances[])`. An
 * `app_instances` row is an instance *of a definition*, and a definition's key
 * equals its `manifest.id` — so "the intents available for the instances I
 * hold" is exactly "the intents whose app id is in {the instances' app ids}".
 * This core has no instance→definition resolution (that needs the DB), so the
 * caller passes the app ids of the instances it holds. With no argument, every
 * registered intent is returned.
 */
export function listIntents(forAppIds?: readonly string[]): AnyIntent[] {
  const all = [...intentsByName.values()];
  if (!forAppIds) return all;
  const wanted = new Set(forAppIds);
  return all.filter((intent) => wanted.has(appIdOf(intent.name)));
}

/** All listeners subscribed to an event type (empty array if none). */
export function getListeners(eventType: string): AnyListener[] {
  return listenersByType.get(eventType) ?? [];
}

/**
 * Remove all registrations. Intended for tests/demos that register throwaway
 * apps and need a clean slate between runs; not used by the shell at runtime.
 */
export function clearRegistry(): void {
  apps.clear();
  intentsByName.clear();
  listenersByType.clear();
}
