"use client";

/**
 * Registers the hand-rolled service worker (`/sw.js`) for offline app-shell
 * caching — but ONLY in production. Runs only in a secure context — browsers
 * restrict service workers to https or localhost, so over a plain-http LAN
 * address it silently no-ops (the app still loads and is add-to-home-screen-able;
 * offline caching just needs a secure origin). See the README for the
 * https/tunnel option.
 *
 * In development the SW is NOT registered; instead any existing registration is
 * unregistered and its caches cleared, so a device that picked up a stale SW
 * (which was serving cached bundles and hiding new dev code) recovers
 * automatically on the next load.
 */
import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (!window.isSecureContext) return;

    // Dev: tear down any previously-registered SW + its caches, then stop.
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) void registration.unregister();
      });
      if (typeof caches !== "undefined") {
        void caches.keys().then((keys) => {
          for (const key of keys) void caches.delete(key);
        });
      }
      return;
    }

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Registration failures are non-fatal — the app works without the SW.
      });
    };

    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
