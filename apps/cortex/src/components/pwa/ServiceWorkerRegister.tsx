"use client";

/**
 * Registers the hand-rolled service worker (`/sw.js`) for offline app-shell
 * caching. Runs only in a secure context — browsers restrict service workers to
 * https or localhost, so over a plain-http LAN address it silently no-ops (the
 * app still loads and is add-to-home-screen-able; offline caching just needs a
 * secure origin). See the README for the https/tunnel option.
 */
import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (!window.isSecureContext) return;

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
