"use client";

/**
 * Client access to the registered apps — a single hook every screen uses so the
 * chips row, Home and the catalog all read from ONE source (the core registry),
 * never a hardcoded list. Ensures the runtime is built (which registers every
 * app, real and stub) before listing.
 */
import { listApps, type AppManifest } from "@platform/cortex-core";
import { ensureRuntimeSync } from "./runtime";

/** The canonical full-screen route for an app id (`/tools/<id>`). */
export function appRoute(id: string): string {
  return `/tools/${id}`;
}

/** All registered app manifests (real + stub), in registration order. */
export function useRegisteredApps(): AppManifest[] {
  // The registry is static and built synchronously; return it directly so the
  // shell paints fully on first render. A registration failure (e.g. a non-
  // secure-origin crypto throw) must not crash render — fall back to [] and log.
  try {
    ensureRuntimeSync();
    return listApps().map((app) => app.manifest);
  } catch (err) {
    console.error("Cortex: failed to load registered apps", err);
    return [];
  }
}
