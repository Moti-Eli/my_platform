/*
 * Cortex service worker — basic offline app-shell caching (hand-rolled, no
 * library). Strategy:
 *   - navigations: network-first, falling back to the cached shell when offline;
 *   - other same-origin GETs: cache-first, refreshed in the background.
 * Bump CACHE_VERSION to invalidate old caches on the next activate.
 *
 * NOTE: browsers only run service workers in a secure context (https or
 * localhost). Over a plain-http LAN address it never registers — that is
 * expected; the app still loads and installs as a home-screen app.
 */
const CACHE_VERSION = "cortex-shell-v2";
const APP_SHELL = [
  "/",
  "/catalog",
  "/comms",
  "/profile",
  "/settings",
  "/manifest.webmanifest",
  "/icons/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // App navigations: try the network, fall back to the cached shell.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/"))),
    );
    return;
  }

  // Everything else: cache-first, updating the cache in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
