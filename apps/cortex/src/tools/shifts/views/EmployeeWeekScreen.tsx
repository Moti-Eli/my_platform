"use client";

/**
 * The employee's screen (stage 2) — "My submission". Part 1 is READ-ONLY: the
 * week's shifts, day by day, with a switch between this week and the next
 * (decision: two weeks ahead). Marking availability (✗ / ★) and the questions
 * come in the next parts, on this same screen.
 *
 * The chosen week lives in the URL (?week=next) via replaceState, so a refresh
 * keeps it and the back button doesn't walk through weeks.
 *
 * "This week" is read only after hydration (`useSyncExternalStore`, server
 * snapshot null): the server's clock/time zone may disagree with the phone's
 * around midnight — the same reason the Home card reads "today" that way.
 */
import { useSyncExternalStore } from "react";
import { useI18n } from "@/i18n";
import type { WeekChoice } from "../nav";
import {
  addDays,
  formatDayMonth,
  formatHours,
  formatWeekRange,
  isoDate,
  isOvernight,
  weekStartOf,
  dateOf,
  weekdayLong,
} from "../time";
import { useClockFormat } from "../clockFormat";
import { shiftsOfDay, useShiftTemplates } from "@/lib/query/useShiftTemplates";
import { EmptyCard, SKELETON, ToolHeader } from "./shared";

const WEEK = [0, 1, 2, 3, 4, 5, 6] as const;
const WEEKS: WeekChoice[] = ["current", "next"];

const noSubscribe = () => () => {};
/** The Sunday of the device's current week, as "YYYY-MM-DD" (null on the server). */
const readThisWeek = () => isoDate(weekStartOf(new Date()));

export function EmployeeWeekScreen({
  week,
  onWeekChange,
}: {
  week: WeekChoice;
  onWeekChange: (next: WeekChoice) => void;
}) {
  const { t, locale } = useI18n();
  const [clockFormat] = useClockFormat(locale);
  const { templates, isLoading, isError } = useShiftTemplates();
  const thisWeek = useSyncExternalStore(noSubscribe, readThisWeek, () => null);

  const weekStart =
    thisWeek === null ? null : addDays(dateOf(thisWeek), week === "next" ? 7 : 0);
  const today = thisWeek === null ? null : isoDate(new Date());

  return (
    <>
      <ToolHeader title={t("shifts.mySubmission")} subtitle={t("shifts.name")} />

      {/* This week / next week — the same segmented look as the day strip. */}
      <div role="tablist" aria-label={t("shifts.weeksLabel")} className="grid grid-cols-2 gap-2xs">
        {WEEKS.map((w) => {
          const active = w === week;
          return (
            <button
              key={w}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onWeekChange(w)}
              className={`flex h-10 items-center justify-center rounded-pill type-label interactive motion-safe:active:scale-[0.97] ${
                active ? "bg-app-coral text-on-fill" : "bg-card text-ink"
              }`}
            >
              {t(w === "next" ? "shifts.nextWeek" : "shifts.thisWeek")}
            </button>
          );
        })}
      </div>

      {weekStart === null ? (
        <span className={`h-4 w-24 ${SKELETON}`} aria-hidden="true" />
      ) : (
        <span className="type-label text-muted">{formatWeekRange(weekStart, locale)}</span>
      )}

      <p className="rounded-md bg-app-coral/15 px-sm py-xs type-caption text-app-coral">
        {t("shifts.availabilitySoon")}
      </p>

      {isLoading || weekStart === null ? (
        <ul className="flex flex-col gap-xs" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className={`h-20 ${SKELETON}`} />
          ))}
        </ul>
      ) : isError ? (
        <EmptyCard titleKey="shifts.loadFailed" />
      ) : (
        <ul className="flex flex-col gap-sm">
          {WEEK.map((wd) => {
            const date = addDays(weekStart, wd);
            const isToday = isoDate(date) === today;
            const dayShifts = shiftsOfDay(templates, wd, locale);
            return (
              <li key={wd} className="flex flex-col gap-2xs">
                <div className="flex items-baseline gap-xs">
                  <span className={`type-label ${isToday ? "text-app-coral" : "text-ink"}`}>
                    {weekdayLong(wd, locale)}
                  </span>
                  <span className="type-caption text-muted">{formatDayMonth(date, locale)}</span>
                </div>
                {dayShifts.length === 0 ? (
                  <span className="rounded-lg bg-card px-md py-sm type-caption text-muted">
                    {t("shifts.noShiftsDay")}
                  </span>
                ) : (
                  <ul className="flex flex-col divide-y divide-hairline rounded-lg bg-card px-md">
                    {dayShifts.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-sm py-sm">
                        <span className="min-w-0 truncate type-body text-ink">{s.name}</span>
                        <span dir="ltr" className="flex shrink-0 items-baseline gap-2xs type-label text-muted">
                          {formatHours(s.startTime, s.endTime, clockFormat, locale)}
                          {isOvernight(s.startTime, s.endTime) ? (
                            <span className="type-caption text-app-coral" title={t("shifts.endsNextDay")}>
                              {t("shifts.nextDayMark")}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
