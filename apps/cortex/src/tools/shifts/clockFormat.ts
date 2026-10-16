"use client";

/**
 * 24-hour vs AM/PM — a per-DEVICE display preference for the shifts tool
 * (localStorage), used by both the time picker and the shift list so they always
 * agree. Default when nothing is saved: Hebrew → 24-hour, English → AM/PM.
 *
 * A tiny external store (`useSyncExternalStore`) so flipping the switch in the
 * picker re-renders every place that shows a time at once. Server snapshot is
 * null (no storage there) → the locale default, so hydration matches; a saved
 * choice applies right after. Every storage access is wrapped.
 */
import { useCallback, useSyncExternalStore } from "react";

export type ClockFormat = "24" | "12";

const KEY = "cortex.shifts.clock";
const listeners = new Set<() => void>();
let cached: ClockFormat | null | undefined;

function read(): ClockFormat | null {
  if (cached !== undefined) return cached;
  try {
    const v = window.localStorage.getItem(KEY);
    cached = v === "24" || v === "12" ? v : null;
  } catch {
    cached = null;
  }
  return cached;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function defaultClockFormat(locale: string): ClockFormat {
  return locale.startsWith("he") ? "24" : "12";
}

/** The current format (saved choice, else the locale default) and a setter. */
export function useClockFormat(locale: string): [ClockFormat, (next: ClockFormat) => void] {
  const saved = useSyncExternalStore(subscribe, read, () => null);
  const set = useCallback((next: ClockFormat) => {
    cached = next;
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // Storage unavailable — the choice still applies for this page view.
    }
    for (const l of listeners) l();
  }, []);
  return [saved ?? defaultClockFormat(locale), set];
}
