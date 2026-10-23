"use client";

/**
 * "This week / next week" — shared by the employee's screen and the manager's
 * availability table (decision: two weeks ahead), with the date range under it.
 *
 * `useThisWeek` reads the device's current week only after hydration
 * (`useSyncExternalStore`, server snapshot null): the server's clock/time zone
 * may disagree with the phone's around midnight.
 */
import { useSyncExternalStore } from "react";
import { useI18n } from "@/i18n";
import type { WeekChoice } from "../nav";
import { addDays, dateOf, formatWeekRange, isoDate, weekStartOf } from "../time";
import { SKELETON } from "./shared";

const WEEKS: WeekChoice[] = ["current", "next"];
const noSubscribe = () => () => {};
const readThisWeek = () => isoDate(weekStartOf(new Date()));

/** The Sunday of the device's current week ("YYYY-MM-DD"), null before hydration. */
export function useThisWeek(): string | null {
  return useSyncExternalStore(noSubscribe, readThisWeek, () => null);
}

/** The chosen week's Sunday as a Date, or null before hydration. */
export function chosenWeekStart(thisWeek: string | null, week: WeekChoice): Date | null {
  return thisWeek === null ? null : addDays(dateOf(thisWeek), week === "next" ? 7 : 0);
}

export function WeekSwitch({
  week,
  weekStart,
  onChange,
}: {
  week: WeekChoice;
  weekStart: Date | null;
  onChange: (next: WeekChoice) => void;
}) {
  const { t, locale } = useI18n();
  return (
    <>
      <div role="tablist" aria-label={t("shifts.weeksLabel")} className="grid grid-cols-2 gap-2xs">
        {WEEKS.map((w) => {
          const active = w === week;
          return (
            <button
              key={w}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(w)}
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
    </>
  );
}
