"use client";

/**
 * TEMPORARY on-device debug console (eruda) — lets you see console logs/errors
 * directly on a phone without USB debugging.
 *
 * ⚠️ DEV ONLY & TEMPORARY. It loads ONLY when NODE_ENV === "development": the
 * `import("eruda")` sits behind that guard, so Next's dead-code elimination
 * drops eruda entirely from production bundles. Remove this component (and the
 * eruda devDependency) once it's no longer needed.
 *
 * To open it: tap the floating eruda button that appears in the bottom corner of
 * the screen — it toggles the console panel.
 */
import { useEffect } from "react";

// Init once even if the effect re-runs (e.g. React StrictMode in dev).
let initialized = false;

export function DevConsole() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || initialized) return;
    let cancelled = false;
    void import("eruda").then((mod) => {
      if (cancelled || initialized) return;
      initialized = true;
      mod.default.init();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
