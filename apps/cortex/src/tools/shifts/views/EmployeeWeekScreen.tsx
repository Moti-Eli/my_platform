"use client";

/**
 * The employee's screen (stage 2) — "My submission": the week's shifts, day by
 * day, with a switch between the next two weeks still OPEN for submitting
 * (`shifts.open_weeks`; a week whose deadline passed is replaced by the one
 * after it — decision), and the employee's MARKS on them (part 3):
 *
 *   tap a shift → a sheet with the three choices, can / can't (✗) / prefer (★),
 *                 the current one highlighted; choosing closes it and saves
 *   questions   → the three built-in ones under the table (SubmissionAnswers,
 *                 part 4), each change saved at once
 *   "Submit"    → stamps submitted_at; shown as "Submitted <time>". A change
 *                 after that shows "Update" until pressed again.
 *
 * LOCKED after the week's deadline (deadline.ts: the manager's shift_weeks row,
 * else the Thursday before at 18:00; a shift_week_reopens row for this employee
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
 * The chosen week lives in the URL (?week=<Sunday>) via replaceState; the switch
 * and the hydration-safe "this week" live in WeekSwitch.tsx (shared with the
 * manager's table). The lock below still matters: a week can close while the
 * screen is open.
 */
import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { runIntentAction } from "@/cortex/actions";
import { CheckIcon, CloseIcon, StarIcon } from "@/components/icons";
import type { WeekChoice } from "../nav";
import type { AvailabilityMark, Mark, MyWeek } from "../logic";
import {
  addDays,
  dateOf,
  formatDayMonth,
  formatHours,
  isLaterThan,
  isoDate,
  isOvernight,
  weekdayLong,
} from "../time";
import { effectiveDeadline, isWeekOpenFor } from "../deadline";
import { useClockFormat } from "../clockFormat";
import { shiftsOfDay, useShiftTemplates } from "@/lib/query/useShiftTemplates";
import { myWeekKey, useMyWeek, useOpenWeeks } from "@/lib/query/useShiftAvailability";
import { SubmissionAnswers } from "./SubmissionAnswers";
import { WeekSwitch, chosenWeek, useThisWeek, weekOptions } from "./WeekSwitch";
import {
  BottomSheet,
  EmptyCard,
  SKELETON,
  ToolHeader,
  WriteErrorBanner,
  useMounted,
  type WriteErrorCode,
} from "./shared";

const WEEK = [0, 1, 2, 3, 4, 5, 6] as const;

/** The choices in the mark sheet, in order. */
const CHOICES: Array<Mark | "can"> = ["can", "cannot", "prefer"];

const markLabelKey = (mark: Mark | "can") =>
  mark === "cannot" ? "shifts.markCannot" : mark === "prefer" ? "shifts.markPrefer" : "shifts.markCan";

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
  const thisWeek = useThisWeek();
  // The next two weeks still open for submitting (server rule); the URL picks one.
  const { openWeeks, isError: openWeeksError } = useOpenWeeks();
  const options = weekOptions(thisWeek, openWeeks, false);
  const weekKey = chosenWeek(thisWeek, options, week);
  const weekStart = weekKey === null ? null : dateOf(weekKey);
  const today = thisWeek === null ? null : isoDate(new Date());

  const { myWeek, isLoading: weekLoading, error: weekError } = useMyWeek(weekKey);
  const schemaMissing = weekError instanceof Error && weekError.message === "schemaMissing";

  const [writeError, setWriteError] = useState<WriteErrorCode | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // One write in flight per shift (the ref is the synchronous truth for the guard).
  const pendingRef = useRef<Set<string>>(new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  // The shift whose mark sheet is open.
  const [picking, setPicking] = useState<{ id: string; title: string } | null>(null);

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
    submission?.submittedAt != null && isLaterThan(submission.updatedAt, submission.submittedAt);

  const markOf = (templateId: string): Mark | "can" =>
    myWeek?.marks.find((m) => m.templateId === templateId)?.mark ?? "can";

  const patchWeek = useCallback(
    (key: string, patch: (prev: MyWeek) => MyWeek) => {
      queryClient.setQueryData<MyWeek>(myWeekKey(key), (prev) => (prev ? patch(prev) : prev));
    },
    [queryClient],
  );

  async function chooseMark(templateId: string, next: Mark | "can") {
    if (weekKey === null || !myWeek || !open || pendingRef.current.has(templateId)) return;
    if (next === markOf(templateId)) return; // same choice — nothing to save
    const key = weekKey;
    const before = myWeek.marks;
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
        const { submissionId, mark, updatedAt: stamp } = res.data as {
          submissionId: string;
          mark: AvailabilityMark | null;
          updatedAt: string;
        };
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

      <WeekSwitch thisWeek={thisWeek} options={options} selected={weekKey} onChange={onWeekChange} />

      {schemaMissing ? (
        <EmptyCard titleKey="shifts.dbNotReadyTitle" hintKey="shifts.dbNotReadyHint" />
      ) : weekError || templatesError || openWeeksError ? (
        <EmptyCard titleKey="shifts.loadFailed" />
      ) : options !== null && options.length === 0 ? (
        <EmptyCard titleKey="shifts.noOpenWeeks" />
      ) : loading || !myWeek || weekStart === null ? (
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
                        const stateLabel = t(markLabelKey(mark));
                        return (
                          <li key={s.id}>
                            <button
                              type="button"
                              disabled={!open || busy}
                              aria-label={`${s.name}: ${stateLabel}`}
                              aria-haspopup="dialog"
                              onClick={() =>
                                setPicking({ id: s.id, title: `${s.name} · ${weekdayLong(wd, locale)}` })
                              }
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

          {/* The built-in questions (part 4); each change saves at once. */}
          {weekKey !== null ? (
            <SubmissionAnswers
              // Fresh drafts per week. NOT keyed on the saved values: a save
              // landing while the user types in the next field would remount
              // and wipe what they are typing.
              key={weekKey}
              weekStart={weekKey}
              submission={submission}
              open={open}
              onError={setWriteError}
            />
          ) : null}

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

          {picking ? (
            <MarkSheet
              title={picking.title}
              current={markOf(picking.id)}
              onClose={() => setPicking(null)}
              onChoose={(mark) => {
                const id = picking.id;
                setPicking(null);
                void chooseMark(id, mark);
              }}
            />
          ) : null}
        </>
      )}
    </>
  );
}

/** The three choices for one shift, from the bottom; the current one is filled. */
function MarkSheet({
  title,
  current,
  onClose,
  onChoose,
}: {
  title: string;
  current: Mark | "can";
  onClose: () => void;
  onChoose: (mark: Mark | "can") => void;
}) {
  const { t } = useI18n();
  return (
    <BottomSheet title={title} onClose={onClose}>
      <div role="radiogroup" aria-label={title} className="flex flex-col gap-xs">
        {CHOICES.map((mark) => {
          const active = mark === current;
          return (
            <button
              key={mark}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChoose(mark)}
              className={`flex h-12 items-center gap-sm rounded-pill px-md type-label interactive motion-safe:active:scale-[0.98] ${
                active
                  ? mark === "cannot"
                    ? "bg-danger text-on-fill"
                    : "bg-app-coral text-on-fill"
                  : "bg-screen text-ink"
              }`}
            >
              {mark === "cannot" ? (
                <CloseIcon width={18} height={18} aria-hidden />
              ) : mark === "prefer" ? (
                <StarIcon width={18} height={18} aria-hidden />
              ) : (
                <CheckIcon width={18} height={18} aria-hidden />
              )}
              {t(markLabelKey(mark))}
            </button>
          );
        })}
      </div>
    </BottomSheet>
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
