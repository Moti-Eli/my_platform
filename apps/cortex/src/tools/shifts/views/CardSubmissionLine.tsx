"use client";

/**
 * The Home card's availability line (stage 2, part 8) — one row under today's
 * shifts, about the week being collected now (the nearest week still OPEN):
 *
 *   employee → "Submission for week X: open until Thu 18:00" / "submitted ✓" /
 *              "changes not submitted"; tap → "My submission" on that week.
 *   manager  → "Submitted 3/5 for week X"; tap → the Availability table.
 *
 * Its own component so its reads (open weeks, the week, the overview) run only
 * for a user who sees it. Home wraps the card in a `<Link>`, so the row calls
 * BOTH preventDefault and stopPropagation and navigates itself.
 */
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n";
import { ChevronIcon } from "@/components/icons";
import { effectiveDeadline } from "../deadline";
import { dateOf, formatDayMonth, isLaterThan } from "../time";
import { visibleEmployees } from "../people";
import { SHIFTS_ROUTE } from "../nav";
import { useMyWeek, useOpenWeeks, useWeekOverview } from "@/lib/query/useShiftAvailability";
import { useOrgMembers, useShiftEmployees } from "@/lib/query/useShiftsStaff";
import { SKELETON } from "./shared";

export function CardSubmissionLine({ manager }: { manager: boolean }) {
  const { openWeeks, isLoading } = useOpenWeeks();
  const week = openWeeks?.[0] ?? null;
  if (isLoading) return <span className={`h-4 w-40 shrink-0 ${SKELETON}`} aria-hidden="true" />;
  if (week === null) return null; // nothing being collected (a far-off manager deadline aside)
  return manager ? <ManagerLine week={week} /> : <EmployeeLine week={week} />;
}

function EmployeeLine({ week }: { week: string }) {
  const { t, locale } = useI18n();
  const { myWeek } = useMyWeek(week);
  if (!myWeek) return <span className={`h-4 w-40 shrink-0 ${SKELETON}`} aria-hidden="true" />;

  const s = myWeek.submission;
  const reopenUntil = myWeek.reopen ? new Date(myWeek.reopen.reopenedUntil) : null;
  const deadline = effectiveDeadline(week, myWeek.week);
  const until = reopenUntil && reopenUntil > deadline ? reopenUntil : deadline;
  const state =
    s?.submittedAt && isLaterThan(s.updatedAt, s.submittedAt)
      ? { key: "shifts.cardSubmissionChanged" as const, tone: "text-app-coral" }
      : s?.submittedAt
        ? { key: "shifts.cardSubmissionDone" as const, tone: "text-ink" }
        : { key: "shifts.cardSubmissionOpen" as const, tone: "text-ink" };
  const text = t(state.key)
    .replace("{week}", formatDayMonth(dateOf(week), locale))
    .replace("{time}", shortTime(until, locale));

  return <Row text={text} tone={state.tone} href={`${SHIFTS_ROUTE}?week=${week}`} />;
}

function ManagerLine({ week }: { week: string }) {
  const { t, locale } = useI18n();
  const { overview } = useWeekOverview(week);
  const { employees, isLoading: empLoading } = useShiftEmployees();
  const { members, isLoading: memLoading } = useOrgMembers();
  if (!overview || empLoading || memLoading) {
    return <span className={`h-4 w-40 shrink-0 ${SKELETON}`} aria-hidden="true" />;
  }
  // The same people and the same "submitted" rule as the Availability table.
  const people = visibleEmployees(employees, members, locale);
  const submitted = people.filter((p) =>
    overview.submissions.some((s) => s.employeeId === p.id && s.submittedAt != null),
  ).length;
  const text = t("shifts.cardSubmittedCount")
    .replace("{x}", String(submitted))
    .replace("{y}", String(people.length))
    .replace("{week}", formatDayMonth(dateOf(week), locale));

  return (
    <Row
      text={text}
      tone={people.length > 0 && submitted === people.length ? "text-ink" : "text-app-coral"}
      href={`${SHIFTS_ROUTE}?view=availability&week=${week}`}
    />
  );
}

function Row({ text, tone, href }: { text: string; tone: string; href: string }) {
  const { dir } = useI18n();
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        router.push(href);
      }}
      className="flex w-full shrink-0 items-center justify-between gap-xs rounded-md bg-screen px-sm py-xs text-start interactive"
    >
      <span className={`min-w-0 truncate type-label ${tone}`}>{text}</span>
      <ChevronIcon
        width={14}
        height={14}
        aria-hidden
        className="shrink-0 text-muted"
        style={{ transform: dir === "rtl" ? undefined : "scaleX(-1)" }}
      />
    </button>
  );
}

/** "יום ה׳ 18:00" — a short weekday and the time. */
function shortTime(d: Date, locale: string): string {
  const day = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(d);
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return `${day} ${time}`;
}
