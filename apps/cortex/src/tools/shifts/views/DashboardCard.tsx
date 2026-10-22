"use client";

/**
 * Shifts dashboard card — the final stage-1 card: TODAY's shifts.
 *
 * Header: the tool's name with today's weekday under it, and a "+" that opens
 * the tool straight on "Add shift" for today (`?day=<today>&add=1`, see nav.ts).
 * Body: today's shifts in the day view's order — name, hours in the device's
 * 24-hour / AM-PM choice ("+1" when it crosses midnight) and how many people it
 * needs in total ("Not set" with no requirements). Tapping a shift opens its
 * edit screen; tapping anywhere else opens the tool on the shifts section.
 *
 * Same frame as the orders/tasks cards: fixed ~1/3 of the visible viewport
 * (`--app-vh`), the list scrolls inside, explicit loading / empty / error
 * states. Home wraps the card in a `<Link>`, so every control here calls BOTH
 * `preventDefault` and `stopPropagation` (see the tasks card for why).
 *
 * HIDDEN for an org member who is neither a manager nor in the tool (decision,
 * stage 2): the tool is open to every member now, so the card asks
 * `shifts.my_access` and renders nothing when the user has no part in shifts.
 * While that answer loads it shows the usual skeleton frame.
 *
 * "Today" is read only after hydration (`useSyncExternalStore`, server snapshot
 * null): the server's clock/time zone may disagree with the phone's around
 * midnight, and the reads are client-side anyway.
 */
import { useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { GridIcon, PlusIcon } from "@/components/icons";
import {
  shiftsOfDay,
  useShiftRequirements,
  useShiftTemplates,
} from "@/lib/query/useShiftTemplates";
import { formatHours, isOvernight, todayWeekday, weekdayLong } from "../time";
import { useClockFormat } from "../clockFormat";
import { totalRequired } from "../staffing";
import { SHIFTS_ROUTE, shiftHref, shiftsAddHref } from "../nav";
import { useShiftAccess } from "@/lib/query/useShiftsStaff";
import { SKELETON, useCountLabel } from "./shared";

const noSubscribe = () => () => {};

export function DashboardCard(_props: ToolViewProps) {
  const { t, locale } = useI18n();
  const count = useCountLabel();
  const router = useRouter();
  const [clockFormat] = useClockFormat(locale);
  const today = useSyncExternalStore(noSubscribe, todayWeekday, () => null);
  const { templates, isLoading, isError } = useShiftTemplates();
  const { requirements, isLoading: reqLoading, isError: reqError } = useShiftRequirements();
  const { access } = useShiftAccess();

  // Neither a manager nor an employee in the tool → no card at all.
  if (access && !access.isAdmin && !access.isEmployee) return null;

  const loading = isLoading || today === null || access === null;
  const shifts = today === null ? [] : shiftsOfDay(templates, today, locale);

  return (
    <div
      className="flex flex-col rounded-lg bg-card p-md"
      style={{ height: "calc(var(--app-vh, 100dvh) / 3)" }}
    >
      <div className="mb-sm flex shrink-0 items-center justify-between gap-xs">
        <div className="flex min-w-0 items-center gap-xs">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-app-coral/15 text-app-coral">
            <GridIcon width={20} height={20} />
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate type-heading text-ink">{t("shifts.name")}</span>
            {today === null ? (
              <span className={`mt-2xs h-3 w-16 ${SKELETON}`} aria-hidden="true" />
            ) : (
              <span className="truncate type-caption text-muted">{weekdayLong(today, locale)}</span>
            )}
          </div>
        </div>
        <button
          type="button"
          aria-label={t("shifts.addShiftToday")}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            router.push(`${SHIFTS_ROUTE}${shiftsAddHref(todayWeekday())}`);
          }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-app-coral text-on-fill interactive motion-safe:active:scale-[0.97]"
        >
          <PlusIcon width={16} height={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <ul className="flex flex-col divide-y divide-hairline" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex items-center justify-between py-sm">
                <span className={`h-4 w-24 ${SKELETON}`} />
                <span className={`h-4 w-20 ${SKELETON}`} />
              </li>
            ))}
          </ul>
        ) : isError ? (
          <p className="type-label text-muted">{t("shifts.loadFailed")}</p>
        ) : shifts.length > 0 ? (
          <ul
            aria-label={t("shifts.todayShiftsLabel")}
            className="flex flex-col divide-y divide-hairline"
          >
            {shifts.map((s) => {
              const people = totalRequired(requirements, s.id);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      router.push(`${SHIFTS_ROUTE}${shiftHref(s.id)}`);
                    }}
                    aria-label={`${t("shifts.editShift")}: ${s.name}`}
                    className="flex w-full items-center justify-between gap-sm py-sm text-start interactive"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate type-body text-ink">{s.name}</span>
                      {/* Requirements still loading / failed: say nothing rather than "Not set". */}
                      {reqLoading || reqError ? null : (
                        <span className="truncate type-caption text-muted">
                          {people > 0
                            ? count(people, "shifts.peopleOne", "shifts.peopleMany")
                            : t("shifts.peopleNotSet")}
                        </span>
                      )}
                    </span>
                    <span dir="ltr" className="flex shrink-0 items-baseline gap-2xs type-label text-muted">
                      {formatHours(s.startTime, s.endTime, clockFormat, locale)}
                      {isOvernight(s.startTime, s.endTime) ? (
                        <span className="type-caption text-app-coral" title={t("shifts.endsNextDay")}>
                          {t("shifts.nextDayMark")}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="type-label text-muted">{t("shifts.noShiftsToday")}</p>
        )}
      </div>
    </div>
  );
}
