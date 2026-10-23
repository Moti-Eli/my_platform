/**
 * Deadline rules for a week's availability submission — PURE, shared by the
 * server logic (which enforces) and the employee screen (which locks the UI),
 * so both always agree.
 *
 * A week is identified by its Sunday ("YYYY-MM-DD"). The effective deadline is:
 *   - the manager's `shift_weeks.deadline_at` for that week, when a row exists;
 *   - otherwise THE DEFAULT (agreed): the WEDNESDAY BEFORE the week, at 18:00.
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

/** The default: 4 days before the week's Sunday = the Wednesday before, 18:00. */
export const DEFAULT_DEADLINE = { daysBeforeWeek: 4, hour: 18, minute: 0 } as const;

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
