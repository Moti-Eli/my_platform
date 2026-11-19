"use client";

/**
 * The week switch — shared by the employee's screen and the manager's
 * availability table, with the chosen week's date range under it. Each screen
 * decides WHICH weeks to offer (`weekOptions`):
 *
 *   employee → the next two weeks still OPEN for submitting (a week whose
 *              deadline passed is skipped; decision);
 *   manager  → this week and next, plus any open weeks beyond them.
 *
 * A tab reads "This week" / "Next week" when it is one of those, else "From
 * <date>". `useThisWeek` reads the device's current week only after hydration
 * (`useSyncExternalStore`, server snapshot null): the server's clock/time zone
 * may disagree with the phone's around midnight.
 */
import { useSyncExternalStore } from "react";
import { useI18n } from "@/i18n";
import type { WeekChoice } from "../nav";
import { addDays, dateOf, formatDayMonth, formatWeekRange, isoDate, weekStartOf } from "../time";
import { SKELETON } from "./shared";

const noSubscribe = () => () => {};
const readThisWeek = () => isoDate(weekStartOf(new Date()));

/** The Sunday of the device's current week ("YYYY-MM-DD"), null before hydration. */
export function useThisWeek(): string | null {
  return useSyncExternalStore(noSubscribe, readThisWeek, () => null);
}

const plusWeek = (iso: string) => isoDate(addDays(dateOf(iso), 7));

/**
 * The weeks a screen offers, nearest first. `open` = the server's open weeks
 * (null while loading → nothing yet). `withCurrent` (the manager) always keeps
 * this week and next in front.
 */
export function weekOptions(
  thisWeek: string | null,
  open: readonly string[] | null,
  withCurrent: boolean,
): string[] | null {
  if (thisWeek === null || open === null) return null;
  const fixed = withCurrent ? [thisWeek, plusWeek(thisWeek)] : [];
  return [...fixed, ...open.filter((w) => !fixed.includes(w))].sort();
}

/** The URL's choice resolved against the offered weeks; else the first. */
export function chosenWeek(
  thisWeek: string | null,
  options: readonly string[] | null,
  choice: WeekChoice,
): string | null {
  if (thisWeek === null || options === null || options.length === 0) return null;
  const asked = choice === "next" ? plusWeek(thisWeek) : choice;
  return asked !== null && options.includes(asked) ? asked : (options[0] ?? null);
}

export function WeekSwitch({
  thisWeek,
  options,
  selected,
  onChange,
}: {
  thisWeek: string | null;
  /** null while loading. */
  options: readonly string[] | null;
  selected: string | null;
  onChange: (week: string) => void;
}) {
  const { t, locale } = useI18n();
  if (thisWeek === null || options === null) {
    return <span className={`h-10 w-full ${SKELETON}`} aria-hidden="true" />;
  }

  const label = (w: string) =>
    w === thisWeek
      ? t("shifts.thisWeek")
      : w === plusWeek(thisWeek)
        ? t("shifts.nextWeek")
        : t("shifts.weekFrom").replace("{date}", formatDayMonth(dateOf(w), locale));

  return (
    <>
      <div
        role="tablist"
        aria-label={t("shifts.weeksLabel")}
        className="grid gap-2xs"
        style={{ gridTemplateColumns: `repeat(${Math.max(options.length, 1)}, minmax(0, 1fr))` }}
      >
        {options.map((w) => {
          const active = w === selected;
          return (
            <button
              key={w}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(w)}
              className={`flex h-10 items-center justify-center whitespace-nowrap rounded-pill px-xs type-label interactive motion-safe:active:scale-[0.97] ${
                active ? "bg-app-coral text-on-fill" : "bg-card text-ink"
              }`}
            >
              {label(w)}
            </button>
          );
        })}
      </div>
      {selected !== null ? (
        <span className="type-label text-muted">{formatWeekRange(dateOf(selected), locale)}</span>
      ) : null}
    </>
  );
}
