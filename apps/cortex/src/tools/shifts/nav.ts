"use client";

/**
 * Where the user is inside the shifts tool — kept in the URL's query string so
 * the phone's back button and a refresh behave (same approach as orders/nav.ts):
 *
 *   (none) / ?day=<0-6>  → shifts (the opening section); `day` = selected weekday
 *   ?day=<0-6>&add=1     → the same, with "Add shift" open (Home's "+"). A ONE-TIME
 *                          signal: the screen removes `add` (replaceState) once
 *                          the dialog is open, so a refresh doesn't reopen it
 *   ?shift=<id>          → one shift's edit screen
 *   ?view=employees      → employees in the tool
 *   ?view=positions      → job positions
 *   ?week=next           → (employee's week screen) next week; absent = this week
 *
 * Switching section or opening a shift PUSHES a history entry (back returns).
 * Picking a day or a week REPLACES the current entry — back must not walk
 * through them.
 * `window.history.pushState/replaceState` are synced by Next into
 * `useSearchParams` with no server round-trip.
 */
import { useCallback } from "react";
import { useSearchParams } from "next/navigation";

/** The tool's route (matches `TOOL_VIEWS.shifts.route`). */
export const SHIFTS_ROUTE = "/tools/shifts";

export type ShiftsSection = "shifts" | "employees" | "positions";

/** The two weeks an employee can look at (decision: this week and the next). */
export type WeekChoice = "current" | "next";

export function shiftsHref(section: ShiftsSection): string {
  return section === "shifts" ? "" : `?view=${section}`;
}

/** Opens the tool on `weekday` with "Add shift" already open (Home's "+"). */
export function shiftsAddHref(weekday: number): string {
  return `?day=${weekday}&add=1`;
}

/** One shift's edit screen. */
export function shiftHref(id: string): string {
  return `?shift=${encodeURIComponent(id)}`;
}

export function useShiftsNav() {
  const params = useSearchParams();
  const view = params.get("view");
  const shiftId = params.get("shift");
  const dayParam = params.get("day");
  const day = dayParam !== null && /^[0-6]$/.test(dayParam) ? Number(dayParam) : null;
  const add = params.get("add") === "1";
  const week: WeekChoice = params.get("week") === "next" ? "next" : "current";

  const section: ShiftsSection =
    view === "employees" || view === "positions" ? view : "shifts";

  const push = useCallback((query: string) => {
    window.history.pushState(null, "", `${window.location.pathname}${query}`);
  }, []);

  const go = useCallback((next: ShiftsSection) => push(shiftsHref(next)), [push]);

  const setDay = useCallback((weekday: number) => {
    window.history.replaceState(null, "", `${window.location.pathname}?day=${weekday}`);
  }, []);

  const openShift = useCallback((id: string) => push(shiftHref(id)), [push]);

  const setWeek = useCallback((next: WeekChoice) => {
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${next === "next" ? "?week=next" : ""}`,
    );
  }, []);

  /** Drops the one-time `add` signal, keeping the day (REPLACES — no new entry). */
  const clearAdd = useCallback(() => {
    const next = new URLSearchParams(window.location.search);
    next.delete("add");
    const query = next.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    );
  }, []);

  return {
    section,
    day,
    shiftId: section === "shifts" ? shiftId : null,
    add: section === "shifts" && !shiftId && add,
    week,
    go,
    setDay,
    setWeek,
    openShift,
    clearAdd,
  };
}
