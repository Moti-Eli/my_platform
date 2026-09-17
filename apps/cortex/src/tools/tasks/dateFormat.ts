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

function toDatetimeLocalValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/** Right now, as the "YYYY-MM-DDTHH:mm" string <input type="datetime-local">
 * expects — the default for a NEW task's due-date field. */
export function nowInputValue(): string {
  return toDatetimeLocalValue(new Date());
}

/** A stored due-date (ISO/timestamptz string, or null/undefined) as the
 * "YYYY-MM-DDTHH:mm" string <input type="datetime-local"> expects, so the
 * EDIT form actually shows the task's existing date/time instead of an empty
 * field (a plain ISO string like "2026-07-16T00:00:00+00:00" is NOT a valid
 * datetime-local value — the browser silently blanks the field on it). */
export function isoToDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return toDatetimeLocalValue(date);
}

/** The reverse of {@link nowInputValue}/{@link isoToDatetimeLocalValue}: a
 * "YYYY-MM-DDTHH:mm" value straight out of <input type="datetime-local"> (which
 * carries NO timezone designator) becomes a real ISO instant to send to the
 * server. `new Date(...)` treats a timezone-less date-TIME string as LOCAL time
 * per spec (unlike a bare date, which it treats as UTC), so this round-trips
 * correctly through whatever timezone the browser is actually in. */
export function datetimeLocalValueToIso(value: string): string {
  return new Date(value).toISOString();
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
