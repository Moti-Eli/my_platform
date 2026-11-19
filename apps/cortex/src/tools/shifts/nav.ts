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
 *   ?view=availability   → (manager) the week's availability table
 *   ?view=mine           → (manager who is also an employee) their own week
 *   ?view=questions      → (manager) the submission questions (from the menu)
 *
 * An EMPLOYEE's sections (their own bar): (none) → "My submission";
 * ?view=week → the week's regular shifts, read-only. Future employee sections
 * (my schedule, hours, pay, history) are new EmployeeSection values here.
 *   ?week=<YYYY-MM-DD>   → the chosen week (its Sunday) on the employee's screen /
 *                          the availability table; absent = the screen's default
 *                          (the old `?week=next` is still understood)
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

export type ShiftsSection = "shifts" | "employees" | "positions" | "availability" | "mine" | "questions";

/** An employee's sections. "mine" (their submission) is the default. */
export type EmployeeSection = "mine" | "week";

function employeeHref(section: EmployeeSection): string {
  return section === "mine" ? "" : `?view=${section}`;
}

/** The week asked for in the URL: a Sunday ("YYYY-MM-DD"), "next", or null =
 * the screen's default. Each screen resolves it against the weeks it offers. */
export type WeekChoice = string | null;

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
  const weekParam = params.get("week");
  const week: WeekChoice =
    weekParam === "next" || (weekParam !== null && /^\d{4}-\d{2}-\d{2}$/.test(weekParam)) ? weekParam : null;

  const section: ShiftsSection =
    view === "employees" ||
    view === "positions" ||
    view === "availability" ||
    view === "mine" ||
    view === "questions"
      ? view
      : "shifts";

  const push = useCallback((query: string) => {
    window.history.pushState(null, "", `${window.location.pathname}${query}`);
  }, []);

  const go = useCallback((next: ShiftsSection) => push(shiftsHref(next)), [push]);
  const goEmployee = useCallback((next: EmployeeSection) => push(employeeHref(next)), [push]);
  const employeeSection: EmployeeSection = view === "week" ? "week" : "mine";

  const setDay = useCallback((weekday: number) => {
    window.history.replaceState(null, "", `${window.location.pathname}?day=${weekday}`);
  }, []);

  const openShift = useCallback((id: string) => push(shiftHref(id)), [push]);

  /** Keeps the section (`view`), replaces the week (no history entry). */
  const setWeek = useCallback((next: WeekChoice) => {
    const params = new URLSearchParams(window.location.search);
    if (next) params.set("week", next);
    else params.delete("week");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
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
    employeeSection,
    go,
    goEmployee,
    setDay,
    setWeek,
    openShift,
    clearAdd,
  };
}
