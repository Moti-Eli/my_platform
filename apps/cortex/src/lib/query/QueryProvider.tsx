"use client";

/**
 * The react-query provider for Cortex. A client component, because a QueryClient
 * is client-only state and the root layout is a server component — so the layout
 * mounts THIS, and this holds the client.
 *
 * The QueryClient is created once via `useState(() => new QueryClient(...))`, not
 * inline: a fresh client on every render would throw away the cache (and every
 * in-flight query) on each re-render. The initializer runs a single time, so the
 * instance is stable for the life of the tree.
 *
 * Defaults are tuned for a TOOL app, not a feed:
 *   - staleTime 30s      — data stays fresh briefly, so navigating between screens
 *                          doesn't refetch on every mount.
 *   - refetchOnWindowFocus false — re-focusing the tab must not refire every query;
 *                          this isn't a live feed.
 *   - retry 1            — one retry on failure, then surface the error honestly
 *                          (the server action already maps failures to stable codes).
 *
 * Identity is untouched by any of this: every query still calls runIntentAction,
 * which calls requireSession server-side, so even a background refetch is
 * re-authenticated. react-query only decides WHEN to call; it never carries who.
 */
import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
