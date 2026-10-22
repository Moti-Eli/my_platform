/**
 * Day and time helpers for the shifts tool. Weekday names come from `Intl` in
 * the app's locale (no hard-coded day names): weekday 0 = Sunday … 6 = Saturday,
 * the same numbering the DB uses.
 */

/** A fixed Sunday, used only to ask `Intl` for weekday names. */
const A_SUNDAY = new Date(2026, 0, 4);

function dateForWeekday(weekday: number): Date {
  const d = new Date(A_SUNDAY);
  d.setDate(A_SUNDAY.getDate() + weekday);
  return d;
}

/** "א׳" / "S" — for the day strip. */
export function weekdayNarrow(weekday: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: "narrow" }).format(dateForWeekday(weekday));
}

/** "יום חמישי" / "Thursday" — for titles and confirmations. */
export function weekdayLong(weekday: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: "long" }).format(dateForWeekday(weekday));
}

/** Today's weekday in the browser's local time (0 = Sunday). */
export function todayWeekday(): number {
  return new Date().getDay();
}

/** An end time earlier than the start time means the shift ends the next day. */
export function isOvernight(startTime: string, endTime: string): boolean {
  return endTime < startTime;
}

/** "HH:MM" → a Date on a fixed day, only for `Intl` formatting. */
function timeAsDate(hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(2026, 0, 4, h ?? 0, m ?? 0);
}

/**
 * "18:00" in 24-hour mode; "6:00 PM" in AM/PM mode — the AM/PM marker comes from
 * `Intl` in the app's locale (no hard-coded text).
 */
export function formatTime(hhmm: string, format: "24" | "12", locale: string): string {
  if (format === "24") return hhmm;
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(timeAsDate(hhmm));
}

/** The localized AM / PM labels, e.g. ["AM","PM"] or ["לפנה״צ","אחה״צ"]. */
export function dayPeriodLabels(locale: string): [string, string] {
  const label = (hour: number) =>
    new Intl.DateTimeFormat(locale, { hour: "numeric", hour12: true })
      .formatToParts(new Date(2026, 0, 4, hour))
      .find((p) => p.type === "dayPeriod")?.value ?? "";
  return [label(1), label(13)];
}

/** "07:00–15:00" (the "+1" for overnight shifts is rendered separately). */
export function formatHours(
  startTime: string,
  endTime: string,
  format: "24" | "12",
  locale: string,
): string {
  return `${formatTime(startTime, format, locale)}–${formatTime(endTime, format, locale)}`;
}

/** A local calendar date as "YYYY-MM-DD" (the device's day, never UTC — see
 * time_entries' `today()` for why). */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" → a local-midnight Date. */
export function dateOf(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(d.getDate() + days);
  return next;
}

/** The Sunday that starts the week `d` falls in (weeks start on Sunday, like
 * `shift_templates.weekday`). */
export function weekStartOf(d: Date): Date {
  const start = addDays(d, -d.getDay());
  start.setHours(0, 0, 0, 0);
  return start;
}

/** "25.10" / "10/25" — a day in the week list. */
export function formatDayMonth(d: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "numeric" }).format(d);
}

/** "25.10–31.10" — the week's Sunday to Saturday. */
export function formatWeekRange(weekStart: Date, locale: string): string {
  return `${formatDayMonth(weekStart, locale)}–${formatDayMonth(addDays(weekStart, 6), locale)}`;
}
