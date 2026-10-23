"use client";

/**
 * The employee's screen (stage 2) — "My submission": the week's shifts, day by
 * day, with a switch between this week and the next (decision: two weeks
 * ahead), and the employee's MARKS on them (part 3):
 *
 *   tap a shift → can → can't (✗) → prefer (★) → can …   saved at once
 *   "Submit"    → stamps submitted_at; shown as "Submitted <time>". A change
 *                 after that shows "Update" until pressed again.
 *
 * LOCKED after the week's deadline (deadline.ts: the manager's shift_weeks row,
 * else the Wednesday before at 18:00; a shift_week_reopens row for this employee
 * reopens it): the rows stop responding and a banner says so. The SERVER
 * enforces the same rule (logic.ts) — this is the UI half.
 *
 * Marks are OPTIMISTIC: the tap patches the shared cache, the server answer
 * replaces it, a failure reverts it and shows why. One tap in flight per shift.
 *
 * NOT MIGRATED YET: until the stage-2 tables exist the read fails with
 * `schemaMissing`, shown as its own explicit screen — so on a preview it is
 * clear that the database is behind, not that the code is broken.
 *
 * The chosen week lives in the URL (?week=next) via replaceState. "This week" is
 * read only after hydration (`useSyncExternalStore`, server snapshot null) — the
 * server's clock/time zone may disagree with the phone's around midnight.
 */
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { runIntentAction } from "@/cortex/actions";
import { CloseIcon, StarIcon } from "@/components/icons";
import type { WeekChoice } from "../nav";
import type { AvailabilityMark, Mark, MyWeek } from "../logic";
import {
  addDays,
  dateOf,
  formatDayMonth,
  formatHours,
  formatWeekRange,
  isoDate,
  isOvernight,
  weekdayLong,
  weekStartOf,
} from "../time";
import { effectiveDeadline, isWeekOpenFor } from "../deadline";
import { useClockFormat } from "../clockFormat";
import { shiftsOfDay, useShiftTemplates } from "@/lib/query/useShiftTemplates";
import { myWeekKey, useMyWeek } from "@/lib/query/useShiftAvailability";
import { EmptyCard, SKELETON, ToolHeader, WriteErrorBanner, useMounted, type WriteErrorCode } from "./shared";

const WEEK = [0, 1, 2, 3, 4, 5, 6] as const;
const WEEKS: WeekChoice[] = ["current", "next"];

const noSubscribe = () => () => {};
/** The Sunday of the device's current week, as "YYYY-MM-DD" (null on the server). */
const readThisWeek = () => isoDate(weekStartOf(new Date()));

/** can → cannot → prefer → can. */
const NEXT: Record<Mark | "can", Mark | "can"> = { can: "cannot", cannot: "prefer", prefer: "can" };

export function EmployeeWeekScreen({
  week,
  onWeekChange,
}: {
  week: WeekChoice;
  onWeekChange: (next: WeekChoice) => void;
}) {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const mounted = useMounted();
  const [clockFormat] = useClockFormat(locale);
  const { templates, isLoading: templatesLoading, isError: templatesError } = useShiftTemplates();
  const thisWeek = useSyncExternalStore(noSubscribe, readThisWeek, () => null);

  const weekStart = thisWeek === null ? null : addDays(dateOf(thisWeek), week === "next" ? 7 : 0);
  const weekKey = weekStart === null ? null : isoDate(weekStart);
  const today = thisWeek === null ? null : isoDate(new Date());

  const { myWeek, isLoading: weekLoading, error: weekError } = useMyWeek(weekKey);
  const schemaMissing = weekError instanceof Error && weekError.message === "schemaMissing";

  const [writeError, setWriteError] = useState<WriteErrorCode | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // One write in flight per shift (the ref is the synchronous truth for the guard).
  const pendingRef = useRef<Set<string>>(new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());

  // Deadline — computed from the same rule the server enforces.
  const now = new Date();
  const open = weekKey !== null && myWeek ? isWeekOpenFor(now, weekKey, myWeek.week, myWeek.reopen) : true;
  const deadline = weekKey !== null && myWeek ? effectiveDeadline(weekKey, myWeek.week) : null;
  const reopenedForMe =
    myWeek?.reopen && deadline && now >= deadline && now < new Date(myWeek.reopen.reopenedUntil)
      ? new Date(myWeek.reopen.reopenedUntil)
      : null;

  const submission = myWeek?.submission ?? null;
  const changedSinceSubmit =
    submission?.submittedAt != null && submission.updatedAt > submission.submittedAt;

  const markOf = (templateId: string): Mark | "can" =>
    myWeek?.marks.find((m) => m.templateId === templateId)?.mark ?? "can";

  const patchWeek = useCallback(
    (key: string, patch: (prev: MyWeek) => MyWeek) => {
      queryClient.setQueryData<MyWeek>(myWeekKey(key), (prev) => (prev ? patch(prev) : prev));
    },
    [queryClient],
  );

  async function cycleMark(templateId: string) {
    if (weekKey === null || !myWeek || !open || pendingRef.current.has(templateId)) return;
    const key = weekKey;
    const before = myWeek.marks;
    const next = NEXT[markOf(templateId)];
    const nextPending = new Set(pendingRef.current).add(templateId);
    pendingRef.current = nextPending;
    setPending(nextPending);
    setWriteError(null);

    // Optimistic: show the next state at once (a placeholder id until the server answers).
    const withoutIt = (list: AvailabilityMark[]) => list.filter((m) => m.templateId !== templateId);
    patchWeek(key, (prev) => ({
      ...prev,
      marks:
        next === "can"
          ? withoutIt(prev.marks)
          : [
              ...withoutIt(prev.marks),
              { id: `pending:${templateId}`, submissionId: prev.submission?.id ?? "", templateId, mark: next },
            ],
    }));

    try {
      const res = await runIntentAction("shifts.set_mark", { weekStart: key, templateId, mark: next });
      if (res.ok) {
        const { submissionId, mark } = res.data as { submissionId: string; mark: AvailabilityMark | null };
        const stamp = new Date().toISOString();
        patchWeek(key, (prev) => ({
          ...prev,
          marks: mark ? [...withoutIt(prev.marks), mark] : withoutIt(prev.marks),
          // The server bumped updated_at; a first tap also created the submission.
          submission: prev.submission
            ? { ...prev.submission, updatedAt: stamp }
            : {
                id: submissionId,
                employeeId: "",
                weekStart: key,
                minShifts: null,
                maxShifts: null,
                doubleShift: null,
                note: "",
                answers: {},
                submittedAt: null,
                updatedAt: stamp,
              },
        }));
      } else {
        patchWeek(key, (prev) => ({ ...prev, marks: before }));
        if (mounted.current) setWriteError(res.code);
        // Closed meanwhile: re-read so the lock shows.
        if (res.code === "weekClosed") void queryClient.invalidateQueries({ queryKey: myWeekKey(key) });
      }
    } finally {
      const cleared = new Set(pendingRef.current);
      cleared.delete(templateId);
      pendingRef.current = cleared;
      if (mounted.current) setPending(cleared);
    }
  }

  async function submit() {
    if (weekKey === null || !open || submitting) return;
    const key = weekKey;
    setSubmitting(true);
    setWriteError(null);
    try {
      const res = await runIntentAction("shifts.submit_week", { weekStart: key });
      if (!mounted.current) return;
      if (res.ok) {
        // Authoritative re-read: the server stamped submitted_at = updated_at.
        await queryClient.invalidateQueries({ queryKey: myWeekKey(key) });
      } else {
        setWriteError(res.code);
        if (res.code === "weekClosed") void queryClient.invalidateQueries({ queryKey: myWeekKey(key) });
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  const fmtTime = (d: Date) =>
    new Intl.DateTimeFormat(locale, {
      weekday: "long",
      day: "numeric",
      month: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);

  const loading = templatesLoading || weekLoading || weekStart === null;

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

      {schemaMissing ? (
        <EmptyCard titleKey="shifts.dbNotReadyTitle" hintKey="shifts.dbNotReadyHint" />
      ) : weekError || templatesError ? (
        <EmptyCard titleKey="shifts.loadFailed" />
      ) : loading || !myWeek ? (
        <ul className="flex flex-col gap-xs" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className={`h-20 ${SKELETON}`} />
          ))}
        </ul>
      ) : (
        <>
          {/* Deadline line, or the lock. */}
          {!open ? (
            <p role="status" className="rounded-md bg-danger/10 px-sm py-xs type-label text-danger">
              {t("shifts.deadlinePassed")}
            </p>
          ) : reopenedForMe ? (
            <p role="status" className="rounded-md bg-app-coral/15 px-sm py-xs type-caption text-app-coral">
              {t("shifts.reopenedUntil").replace("{time}", fmtTime(reopenedForMe))}
            </p>
          ) : deadline ? (
            <p className="type-caption text-muted">
              {t("shifts.deadlineUntil").replace("{time}", fmtTime(deadline))}
            </p>
          ) : null}
          {open ? <p className="type-caption text-muted">{t("shifts.markLegend")}</p> : null}

          <WriteErrorBanner code={writeError} />

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
                      {dayShifts.map((s) => {
                        const mark = markOf(s.id);
                        const busy = pending.has(s.id);
                        const stateLabel = t(
                          mark === "cannot"
                            ? "shifts.markCannot"
                            : mark === "prefer"
                              ? "shifts.markPrefer"
                              : "shifts.markCan",
                        );
                        return (
                          <li key={s.id}>
                            <button
                              type="button"
                              disabled={!open || busy}
                              aria-label={`${s.name}: ${stateLabel}`}
                              onClick={() => void cycleMark(s.id)}
                              className={`flex w-full items-center justify-between gap-sm py-sm text-start interactive motion-safe:active:scale-[0.99] ${
                                !open ? "opacity-[var(--ds-disabled-opacity)]" : ""
                              }`}
                            >
                              <span className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate type-body text-ink">{s.name}</span>
                                <span dir="ltr" className="flex items-baseline gap-2xs self-start type-caption text-muted">
                                  {formatHours(s.startTime, s.endTime, clockFormat, locale)}
                                  {isOvernight(s.startTime, s.endTime) ? (
                                    <span className="text-app-coral" title={t("shifts.endsNextDay")}>
                                      {t("shifts.nextDayMark")}
                                    </span>
                                  ) : null}
                                </span>
                              </span>
                              <MarkPill mark={mark} label={stateLabel} />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Submit — status line + the one button. */}
          <div className="flex items-center justify-between gap-sm rounded-lg bg-card p-md">
            <span className="flex min-w-0 flex-col">
              <span className="type-label text-ink">
                {submission?.submittedAt
                  ? t("shifts.submittedAt").replace("{time}", fmtTime(new Date(submission.submittedAt)))
                  : t("shifts.notSubmitted")}
              </span>
              {changedSinceSubmit ? (
                <span className="type-caption text-app-coral">{t("shifts.changedSinceSubmit")}</span>
              ) : null}
            </span>
            {open && (!submission?.submittedAt || changedSinceSubmit) ? (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void submit()}
                className="shrink-0 rounded-pill bg-app-coral px-md py-xs type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
              >
                {t(submission?.submittedAt ? "shifts.updateSubmission" : "shifts.submit")}
              </button>
            ) : null}
          </div>
        </>
      )}
    </>
  );
}

/** The state pill at the end of a shift row: ✗ can't / ★ prefer / muted "can". */
function MarkPill({ mark, label }: { mark: Mark | "can"; label: string }) {
  if (mark === "cannot") {
    return (
      <span className="flex shrink-0 items-center gap-2xs rounded-pill bg-danger/10 px-sm py-2xs type-caption text-danger">
        <CloseIcon width={14} height={14} aria-hidden />
        {label}
      </span>
    );
  }
  if (mark === "prefer") {
    return (
      <span className="flex shrink-0 items-center gap-2xs rounded-pill bg-app-coral/15 px-sm py-2xs type-caption text-app-coral">
        <StarIcon width={14} height={14} aria-hidden />
        {label}
      </span>
    );
  }
  return <span className="shrink-0 type-caption text-muted">{label}</span>;
}
