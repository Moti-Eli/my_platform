/**
 * Date/time helpers shared by the tasks views (`FullScreen`, `DashboardCard`).
 * `due_date` is `timestamptz` end-to-end (DB, logic.ts, the AI intent schema) —
 * it always carries a real time, not just a date; these helpers are what let the
 * UI actually show and edit that time instead of silently dropping it.
 *
 * Every "build an input value" helper here works from the `Date` object's LOCAL
 * calendar parts — never `toISOString()`, which converts to UTC first (late in
 * the evening in Israel that silently rolls the date to tomorrow).
 */
import type { Locale } from "@/i18n";

/** Today's date as the "YYYY-MM-DD" string <input type="date"> expects — the
 * default for a NEW task's date field. Built from LOCAL calendar parts (see
 * file header), never `toISOString()`. */
export function todayDateValue(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** A stored due-date (ISO/timestamptz, or null/undefined) split into the
 * separate "YYYY-MM-DD" / "HH:mm" values the date and time inputs each
 * expect.
 *
 * EXACT LOCAL MIDNIGHT comes back with an EMPTY `time` — by convention
 * (matching `formatDueDate`'s own display rule below) midnight means "no time
 * was ever chosen for this date", not "due at 00:00". A task saved with a
 * date but no time (see `dateAndTimeToIso`) round-trips back to an empty time
 * field here, not a fabricated 00:00 that looks like a real, chosen time. */
export function isoToDateAndTime(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const isMidnight = hours === 0 && minutes === 0;
  return {
    date: `${d.getFullYear()}-${month}-${day}`,
    time: isMidnight ? "" : `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
  };
}

/** The reverse of {@link isoToDateAndTime}: a date input's "YYYY-MM-DD" value
 * (required) plus a time input's "HH:mm" value (OPTIONAL — an empty time is a
 * real "no time chosen", not a missing field) becomes one ISO instant to send
 * to the server.
 *
 * An empty time defaults to midnight: `due_date` is a single timestamptz, so
 * a date-only task still needs SOME instant to store, and midnight of that
 * day is exactly what "no time" already means everywhere else in this file
 * (`isoToDateAndTime`, `formatDueDate`'s display rule) — so a task saved
 * date-only today still reads as date-only (no "00:00") everywhere it's
 * shown, and round-trips back to an empty time field if reopened for editing.
 *
 * `new Date(...)` treats a timezone-less date-TIME string as LOCAL time per
 * spec (unlike a bare date, which it treats as UTC), so this round-trips
 * correctly through whatever timezone the browser is actually in. */
export function dateAndTimeToIso(date: string, time: string): string {
  return new Date(`${date}T${time.trim() === "" ? "00:00" : time}`).toISOString();
}

/** Midnight (local time) on the SUNDAY of `date`'s week — the week view's
 * anchor. `getDay()` is 0 for Sunday, so subtracting it always lands on
 * Sunday regardless of which day of the week `date` is. */
export function startOfWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - start.getDay());
  return start;
}

/** `date` shifted by `days` (negative goes backward) — used for both the
 * week's 7 columns and the prev/next-week navigation. Never mutates `date`. */
export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Whether two Dates fall on the same LOCAL calendar day — the week view's
 * "does this task belong in this column" test. Deliberately ignores time of
 * day and never compares via UTC (see the file header). */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** A day column's weekday label (e.g. "יום א׳" / "Sun"), via Intl — never a
 * hard-coded day-name list, so it follows the language toggle and is
 * correct for every locale's own week-day naming. */
export function formatWeekday(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);
}

/** The week-nav header label spanning `weekStart`'s Sunday through Saturday
 * (e.g. "16–22 ביולי" / "Jul 16 – 22"). */
export function formatWeekRangeLabel(weekStart: Date, locale: Locale): string {
  const weekEnd = addDays(weekStart, 6);
  const format = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
  return `${format.format(weekStart)} – ${format.format(weekEnd)}`;
}

/** A stored due-date formatted for READING, in the active UI locale — date and
 * time together (e.g. "16 ביולי 2026, 10:23" in he / "Jul 16, 2026, 10:23 AM"
 * in en). Uses Intl so the format follows the language toggle rather than a
 * hard-coded pattern (Standard §8: no hard-coded text).
 *
 * EXACT LOCAL midnight (00:00) drops the time and shows the date alone — a task
 * due-dated without ever touching the time picker lands on midnight, and
 * showing "00:00" for it would read as a real (and misleading) deadline time. */
export function formatDueDate(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const isMidnight = date.getHours() === 0 && date.getMinutes() === 0;
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(isMidnight ? {} : { hour: "2-digit", minute: "2-digit" }),
  }).format(date);
}
