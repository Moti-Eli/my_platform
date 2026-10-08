"use client";

/**
 * Which section of the shifts tool is open — kept in the URL's query string so
 * the phone's back button and a refresh behave (same approach as orders/nav.ts):
 *
 *   (none)             → shifts (the opening section)
 *   ?view=employees    → employees in the tool
 *   ?view=positions    → job positions
 *
 * `window.history.pushState` is synced by Next into `useSearchParams` with no
 * server round-trip.
 */
import { useCallback } from "react";
import { useSearchParams } from "next/navigation";

/** The tool's route (matches `TOOL_VIEWS.shifts.route`). */
export const SHIFTS_ROUTE = "/tools/shifts";

export type ShiftsSection = "shifts" | "employees" | "positions";

export function shiftsHref(section: ShiftsSection): string {
  return section === "shifts" ? "" : `?view=${section}`;
}

export function useShiftsNav() {
  const params = useSearchParams();
  const view = params.get("view");
  const section: ShiftsSection =
    view === "employees" || view === "positions" ? view : "shifts";

  const go = useCallback((next: ShiftsSection) => {
    window.history.pushState(null, "", `${window.location.pathname}${shiftsHref(next)}`);
  }, []);

  return { section, go };
}
