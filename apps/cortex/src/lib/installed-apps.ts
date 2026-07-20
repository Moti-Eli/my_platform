"use client";

/**
 * Installed-apps state — the single source of truth for WHICH apps the user has
 * added to their shell (their `app_instances`, in Cortex terms).
 *
 * The public interface is intentionally tiny and storage-agnostic:
 *   listInstalled() / isInstalled(id) / install(id) / uninstall(id) / subscribe()
 * Screens use it (via {@link useInstalledApps}) and never touch the backend.
 *
 * TEMPORARY BACKEND: there is no auth yet, so this is persisted to localStorage,
 * isolated entirely behind the functions below. When Cortex auth + Supabase land,
 * swap the read/write helpers for `app_instances` queries — no screen changes.
 *
 * Initial state: nothing installed.
 */
import { useEffect, useState } from "react";

const STORAGE_KEY = "cortex.installedApps";
const PINNED_KEY = "cortex.pinnedApps";

type Listener = () => void;
const listeners = new Set<Listener>();

// ---- TEMPORARY localStorage backend (swap for Supabase app_instances) -------

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    // The stored shape is (and always has been) a JSON string array whose ORDER
    // is the install order. Be defensive about anything else (old/corrupt state):
    // ignore non-arrays, keep only strings, and de-dupe while preserving the
    // first-seen (install) order — never throw.
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

function write(ids: string[]): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } catch {
      /* ignore quota/availability errors — state still lives in memory this session */
    }
  }
  for (const listener of listeners) listener();
}

// ---- TEMPORARY localStorage backend: pinned ids (parallel to installed) ------

function readPinned(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PINNED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    // Same shape as read(): a JSON string array whose ORDER is the pin order. Be
    // defensive about anything else (old/corrupt state): ignore non-arrays, keep
    // only strings, de-dupe preserving first-seen (pin) order — never throw.
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

// ---- Public interface (storage-agnostic) ------------------------------------

/** The ids of apps the user has installed, in INSTALL order (first installed
 * first, newly installed last). Consumers render in exactly this order. */
export function listInstalled(): string[] {
  return read();
}

/** Whether a given app id is installed. */
export function isInstalled(id: string): boolean {
  return read().includes(id);
}

/** Add an app to the user's shell (no-op if already installed). */
export function install(id: string): void {
  const ids = read();
  if (ids.includes(id)) return;
  write([...ids, id]);
}

/** Remove an app from the user's shell (no-op if not installed). An uninstalled
 * app can't be pinned, so it is dropped from the pinned store too. */
export function uninstall(id: string): void {
  const ids = read();
  if (!ids.includes(id)) return;
  write(ids.filter((existing) => existing !== id));
  const pinned = readPinned();
  if (pinned.includes(id)) {
    writePinned(pinned.filter((existing) => existing !== id));
  }
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

/** Subscribe to install/uninstall changes. Returns an unsubscribe function. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ---- React binding ----------------------------------------------------------

/**
 * Reactive view of the installed-app ids. Starts empty on the server and first
 * client paint (so hydration matches), then loads from the backend and stays in
 * sync with install()/uninstall() from anywhere.
 */
export function useInstalledApps(): string[] {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    setIds(listInstalled());
    return subscribe(() => setIds(listInstalled()));
  }, []);
  return ids;
}

/**
 * Reactive view of the pinned-app ids. Same shape as {@link useInstalledApps}:
 * empty on the server and first client paint, then loads from the backend and
 * stays in sync with togglePin()/uninstall() from anywhere.
 */
export function usePinnedApps(): string[] {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    setIds(listPinned());
    return subscribe(() => setIds(listPinned()));
  }, []);
  return ids;
}
