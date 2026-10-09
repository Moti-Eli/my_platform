"use client";

/**
 * Where the user is inside the shifts tool — kept in the URL's query string so
 * the phone's back button and a refresh behave (same approach as orders/nav.ts):
 *
 *   (none) / ?day=<0-6>  → shifts (the opening section); `day` = selected weekday
 *   ?shift=<id>          → one shift's edit screen
 *   ?view=employees      → employees in the tool
 *   ?view=positions      → job positions
 *
 * Switching section or opening a shift PUSHES a history entry (back returns).
 * Picking a day REPLACES the current entry — back must not walk through days.
 * `window.history.pushState/replaceState` are synced by Next into
 * `useSearchParams` with no server round-trip.
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
  const shiftId = params.get("shift");
  const dayParam = params.get("day");
  const day = dayParam !== null && /^[0-6]$/.test(dayParam) ? Number(dayParam) : null;

  const section: ShiftsSection =
    view === "employees" || view === "positions" ? view : "shifts";

  const push = useCallback((query: string) => {
    window.history.pushState(null, "", `${window.location.pathname}${query}`);
  }, []);

  const go = useCallback((next: ShiftsSection) => push(shiftsHref(next)), [push]);

  const setDay = useCallback((weekday: number) => {
    window.history.replaceState(null, "", `${window.location.pathname}?day=${weekday}`);
  }, []);

  const openShift = useCallback(
    (id: string) => push(`?shift=${encodeURIComponent(id)}`),
    [push],
  );

  return { section, day, shiftId: section === "shifts" ? shiftId : null, go, setDay, openShift };
}
