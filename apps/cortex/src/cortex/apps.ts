"use client";

/**
 * Client access to the registered apps — a single hook every screen uses so the
 * chips row, Home and the catalog all read from ONE source (the core registry),
 * never a hardcoded list. Ensures the runtime is built (which registers every
 * app, real and stub) before listing.
 */
import { useEffect, useState } from "react";
import { listApps, type AppManifest } from "@platform/cortex-core";
import { getRuntime } from "./runtime";

/** The canonical full-screen route for an app id (`/tools/<id>`). */
export function appRoute(id: string): string {
  return `/tools/${id}`;
}

/** All registered app manifests (real + stub), in registration order. */
export function useRegisteredApps(): AppManifest[] {
  const [apps, setApps] = useState<AppManifest[]>([]);
  useEffect(() => {
    let alive = true;
    getRuntime()
      .then(() => {
        if (alive) setApps(listApps().map((app) => app.manifest));
      })
      .catch((err: unknown) => {
        // Never leave the chips/catalog silently empty — surface the failure.
        console.error("Cortex: failed to load registered apps", err);
      });
    return () => {
      alive = false;
    };
  }, []);
  return apps;
}
