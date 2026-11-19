/**
 * Deadline rules for a week's availability submission — PURE, shared by the
 * server logic (which enforces) and the employee screen (which locks the UI),
 * so both always agree.
 *
 * A week is identified by its Sunday ("YYYY-MM-DD"). The effective deadline is:
 *   - the manager's `shift_weeks.deadline_at` for that week, when a row exists;
 *   - otherwise THE DEFAULT (agreed): the THURSDAY BEFORE the week, at 18:00.
 * And an employee may still edit after it while a `shift_week_reopens` row for
 * them says `reopened_until` is in the future.
 *
 * TIME ZONE: 18:00 is a wall-clock time. The server (UTC) cannot know the
 * phone's zone, and the two sides must compute the SAME instant, so the default
 * is anchored to one business zone (`SHIFTS_TIME_ZONE`). A manager-set deadline
 * is an absolute instant and needs no zone. Known limitation, documented in
 * apps/cortex/README.md: one zone per deployment, not per org.
 */

export const SHIFTS_TIME_ZONE = "Asia/Jerusalem";

/** The default: 3 days before the week's Sunday = the Thursday before, 18:00. */
export const DEFAULT_DEADLINE = { daysBeforeWeek: 3, hour: 18, minute: 0 } as const;

/** How many open weeks an employee is offered (decision: the next two). */
export const OPEN_WEEKS_SHOWN = 2;
/** How far ahead to look for them — far past any sane manager deadline. */
const OPEN_WEEKS_HORIZON = 8;

/** Minutes east of UTC that `tz` is at the instant `at`. */
function tzOffsetMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** The instant of `hh:mm` on the calendar day y-m-d in `tz`. */
function zonedInstant(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  return new Date(guess - tzOffsetMinutes(new Date(guess), tz) * 60_000);
}

/** The default deadline for the week starting on `weekStart` ("YYYY-MM-DD"). */
export function defaultDeadline(weekStart: string): Date {
  const [y, m, d] = weekStart.split("-").map(Number);
  const day = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  day.setUTCDate(day.getUTCDate() - DEFAULT_DEADLINE.daysBeforeWeek);
  return zonedInstant(
    day.getUTCFullYear(),
    day.getUTCMonth() + 1,
    day.getUTCDate(),
    DEFAULT_DEADLINE.hour,
    DEFAULT_DEADLINE.minute,
    SHIFTS_TIME_ZONE,
  );
}

/** The manager's deadline for the week, else the default. */
export function effectiveDeadline(
  weekStart: string,
  week: { deadlineAt: string } | null | undefined,
): Date {
  return week ? new Date(week.deadlineAt) : defaultDeadline(weekStart);
}

/** May THIS employee still change their submission for the week, right now? */
export function isWeekOpenFor(
  now: Date,
  weekStart: string,
  week: { deadlineAt: string } | null | undefined,
  reopen: { reopenedUntil: string } | null | undefined,
): boolean {
  if (now < effectiveDeadline(weekStart, week)) return true;
  return reopen ? now < new Date(reopen.reopenedUntil) : false;
}

/** The Sunday ("YYYY-MM-DD") of the week `now` falls in, in the business zone. */
export function currentWeekStart(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SHIFTS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const day = new Date(Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day"))));
  day.setUTCDate(day.getUTCDate() - Math.max(dow, 0));
  return day.toISOString().slice(0, 10);
}

/**
 * The first OPEN_WEEKS_SHOWN weeks, from this week on, that are still open for
 * this employee — the weeks their screen offers. A week whose deadline passed
 * is skipped and the one after it is offered instead (decision).
 */
export function openWeeks(
  now: Date,
  weeks: readonly { weekStart: string; deadlineAt: string }[],
  reopens: readonly { weekStart: string; reopenedUntil: string }[],
): string[] {
  const open: string[] = [];
  const first = new Date(`${currentWeekStart(now)}T00:00:00Z`);
  for (let i = 0; i < OPEN_WEEKS_HORIZON && open.length < OPEN_WEEKS_SHOWN; i++) {
    const day = new Date(first);
    day.setUTCDate(first.getUTCDate() + 7 * i);
    const ws = day.toISOString().slice(0, 10);
    const week = weeks.find((w) => w.weekStart === ws);
    const reopen = reopens.find((r) => r.weekStart === ws);
    if (isWeekOpenFor(now, ws, week, reopen)) open.push(ws);
  }
  return open;
}
