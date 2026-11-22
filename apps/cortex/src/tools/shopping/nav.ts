"use client";

/**
 * Where the user is inside the shopping tool — in the URL, so the phone's back
 * button and a refresh behave (the shifts nav.ts approach):
 *
 *   (none)        → "My lists" — every list the user is in, across their orgs
 *   ?list=<id>    → one list, opened IN PLACE: no org switch, no reload
 *
 * Opening a list PUSHES a history entry, so back returns to "My lists".
 * `window.history.pushState` is synced by Next into `useSearchParams` with no
 * server round-trip.
 */
import { useCallback } from "react";
import { useSearchParams } from "next/navigation";

/** The tool's route (the static page under app/(app)/tools/shopping). */
export const SHOPPING_ROUTE = "/tools/shopping";

/** One list's address (for links from elsewhere, e.g. the Home card later). */
export function listHref(id: string): string {
  return `${SHOPPING_ROUTE}?list=${encodeURIComponent(id)}`;
}

export function useShoppingNav() {
  const params = useSearchParams();
  const listId = params.get("list");

  const openList = useCallback((id: string) => {
    window.history.pushState(null, "", `${window.location.pathname}?list=${encodeURIComponent(id)}`);
  }, []);

  return { listId, openList };
}
