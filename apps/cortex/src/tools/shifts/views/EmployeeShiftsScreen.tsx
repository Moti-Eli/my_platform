"use client";

/**
 * The employee's "Shifts" section — the week's REGULAR shifts (the templates the
 * manager set), Sunday → Saturday, READ-ONLY: name and hours ("+1" when a shift
 * crosses midnight). Today's day is highlighted, read only after hydration (the
 * server's clock/time zone may disagree with the phone's around midnight).
 * Nothing here writes; the manager edits shifts in their own Shifts section.
 */
import { useSyncExternalStore } from "react";
import { useI18n } from "@/i18n";
import { formatHours, isOvernight, todayWeekday, weekdayLong } from "../time";
import { useClockFormat } from "../clockFormat";
import { shiftsOfDay, useShiftTemplates } from "@/lib/query/useShiftTemplates";
import { EmptyCard, SKELETON, ToolHeader } from "./shared";

const WEEK = [0, 1, 2, 3, 4, 5, 6] as const;
const noSubscribe = () => () => {};

export function EmployeeShiftsScreen() {
  const { t, locale } = useI18n();
  const [clockFormat] = useClockFormat(locale);
  const { templates, isLoading, isError } = useShiftTemplates();
  const today = useSyncExternalStore(noSubscribe, todayWeekday, () => null);

  return (
    <>
      <ToolHeader title={t("shifts.regularShiftsTitle")} subtitle={t("shifts.name")} />
      {isError ? (
        <EmptyCard titleKey="shifts.loadFailed" />
      ) : isLoading ? (
        <ul className="flex flex-col gap-xs" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className={`h-16 ${SKELETON}`} />
          ))}
        </ul>
      ) : templates.length === 0 ? (
        <EmptyCard titleKey="shifts.regularShiftsEmpty" />
      ) : (
        <>
          <p className="type-caption text-muted">{t("shifts.regularShiftsHint")}</p>
          <ul className="flex flex-col gap-sm">
            {WEEK.map((wd) => {
              const dayShifts = shiftsOfDay(templates, wd, locale);
              return (
                <li key={wd} className="flex flex-col gap-2xs">
                  <span className={`type-label ${wd === today ? "text-app-coral" : "text-ink"}`}>
                    {weekdayLong(wd, locale)}
                  </span>
                  {dayShifts.length === 0 ? (
                    <span className="rounded-lg bg-card px-md py-sm type-caption text-muted">
                      {t("shifts.noShiftsDay")}
                    </span>
                  ) : (
                    <ul className="flex flex-col divide-y divide-hairline rounded-lg bg-card px-md">
                      {dayShifts.map((s) => (
                        <li key={s.id} className="flex items-center justify-between gap-sm py-sm">
                          <span className="min-w-0 flex-1 truncate type-body text-ink">{s.name}</span>
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
        </>
      )}
    </>
  );
}
