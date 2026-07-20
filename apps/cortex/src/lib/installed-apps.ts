"use client";

/**
 * Installed-apps state — the single source of truth for WHICH apps the user has
 * added to their shell (their `app_instances`, in Cortex terms).
 *
 * BACKEND: `public.app_instances`, per-user-per-org, reached through the SERVER
 * ACTIONS in `@/lib/installed-apps.actions`. Identity is never passed from here —
 * each action derives it from `requireSession()` (the session cookie), so a
 * react-query background refetch is re-authenticated exactly like the first fetch.
 *
 * The read keeps its ORIGINAL SHAPE — `useInstalledApps(): string[]` in install
 * order — so screens (Home, AppShell, Header, catalog) did not change. Writes moved
 * to {@link useAppInstaller}, which applies an OPTIMISTIC cache update and then
 * reconciles against the server (invalidate on success, invalidate to revert on
 * failure). Mirrors the `useStaffMembers` pattern.
 *
 * PINNED apps are a SEPARATE, still-local concern: pin order is a device
 * preference, not org state, so it remains in localStorage behind the functions at
 * the bottom of this file. Untouched by the server swap.
 */
import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listInstalledApps,
  installApp,
  uninstallApp,
} from "@/lib/installed-apps.actions";

/** The single queryKey every installed-apps consumer shares. */
export const INSTALLED_APPS_KEY = ["installed-apps"] as const;

// ---- Installed apps (server-backed) -----------------------------------------

/**
 * Reactive view of the installed-app ids, in INSTALL order (earliest first).
 * Returns `[]` while loading or on error, so callers never branch on undefined —
 * the same `string[]` contract the localStorage version had.
 */
export function useInstalledApps(): string[] {
  const query = useQuery({
    queryKey: INSTALLED_APPS_KEY,
    queryFn: listInstalledApps,
  });
  return query.data ?? [];
}

/**
 * The two writes, both OPTIMISTIC: the shared cache flips immediately so the chips
 * row / catalog badge respond on tap, then the server action runs. On success we
 * invalidate to pick up the authoritative order; on failure we ALSO invalidate,
 * which refetches and thereby reverts the optimistic edit. A raw error string is
 * never surfaced — the list simply snaps back to the truth.
 */
export function useAppInstaller(): {
  install: (appKey: string) => void;
  uninstall: (appKey: string) => void;
} {
  const qc = useQueryClient();

  const install = useCallback(
    (appKey: string) => {
      qc.setQueryData<string[]>(INSTALLED_APPS_KEY, (prev) =>
        prev?.includes(appKey) ? prev : [...(prev ?? []), appKey],
      );
      void (async () => {
        try {
          await installApp(appKey);
        } finally {
          // Success: adopt the server's authoritative list. Failure: the refetch
          // IS the revert.
          void qc.invalidateQueries({ queryKey: INSTALLED_APPS_KEY });
        }
      })();
    },
    [qc],
  );

  const uninstall = useCallback(
    (appKey: string) => {
      qc.setQueryData<string[]>(INSTALLED_APPS_KEY, (prev) =>
        (prev ?? []).filter((k) => k !== appKey),
      );
      void (async () => {
        try {
          await uninstallApp(appKey);
        } finally {
          void qc.invalidateQueries({ queryKey: INSTALLED_APPS_KEY });
        }
      })();
    },
    [qc],
  );

  return { install, uninstall };
}

// ---- Pinned apps (device-local; NOT part of the server swap) ----------------

const PINNED_KEY = "cortex.pinnedApps";

type Listener = () => void;
const listeners = new Set<Listener>();

function readPinned(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PINNED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    // A JSON string array whose ORDER is the pin order. Be defensive about
    // anything else (old/corrupt state): ignore non-arrays, keep only strings,
    // de-dupe preserving first-seen (pin) order — never throw.
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const value of parsed) {
      if (typeof value === "string" && !seen.has(value)) {
        seen.add(value);
        ids.push(value);
      }
    }
    return ids;
  } catch {
    return [];
  }
}

function writePinned(ids: string[]): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(PINNED_KEY, JSON.stringify(ids));
    } catch {
      /* ignore quota/availability errors — state still lives in memory this session */
    }
  }
  for (const listener of listeners) listener();
}

/** Subscribe to pin changes. Returns an unsubscribe function. Internal: the only
 * consumer is {@link usePinnedApps}. */
function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The ids of pinned apps, in PIN order (first pinned first, newly pinned last).
 * Pinned apps sort to the front of the chips row. */
export function listPinned(): string[] {
  return readPinned();
}

/** Whether a given app id is pinned. */
export function isPinned(id: string): boolean {
  return readPinned().includes(id);
}

/** Toggle an app's pinned state: unpin if pinned, else pin (append to the end). */
export function togglePin(id: string): void {
  const ids = readPinned();
  if (ids.includes(id)) {
    writePinned(ids.filter((existing) => existing !== id));
  } else {
    writePinned([...ids, id]);
  }
}

/**
 * Reactive view of the pinned-app ids. Empty on the server and first client paint
 * (so hydration matches), then loads from localStorage and stays in sync with
 * togglePin() from anywhere. A pin for an app that is no longer installed is inert
 * — AppShell intersects this list with the installed one before rendering.
 */
export function usePinnedApps(): string[] {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    setIds(listPinned());
    return subscribe(() => setIds(listPinned()));
  }, []);
  return ids;
}
