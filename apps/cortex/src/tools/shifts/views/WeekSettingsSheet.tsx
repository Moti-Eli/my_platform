"use client";

/**
 * The manager's week settings (stage 2, part 6) — the ⚙ by the week on the
 * availability table. One write, `shifts.set_week_deadline`, covers all three:
 *
 *   open    → "Submission deadline" (date + time; prefilled with the effective
 *             one — the default is the Thursday before, 18:00) + "Close now"
 *             (= the deadline becomes now).
 *   closed  → "Reopen for everyone until" (date + time, default tomorrow 18:00).
 *
 * Times are entered in the phone's local time and sent as absolute instants.
 * After a save the overview, the open-weeks list and the manager's own week are
 * re-read, so the table, the tabs and "Mine" agree at once.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { runIntentAction } from "@/cortex/actions";
import type { ShiftWeek } from "../logic";
import { weekStatus } from "../deadline";
import { formatWeekRange, dateOf, fromLocalInput, toLocalInput, tomorrowAt18 } from "../time";
import { OPEN_WEEKS_KEY, myWeekKey, weekOverviewKey } from "@/lib/query/useShiftAvailability";
import { BottomSheet, WriteErrorBanner, inputClass, invalidRing, useMounted, type WriteErrorCode } from "./shared";

/** Re-read everything a week setting affects. */
export function useWeekSettingsRefresh() {
  const queryClient = useQueryClient();
  return (weekStart: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: weekOverviewKey(weekStart) }),
      queryClient.invalidateQueries({ queryKey: OPEN_WEEKS_KEY }),
      queryClient.invalidateQueries({ queryKey: myWeekKey(weekStart) }),
    ]);
}

export function WeekSettingsSheet({
  weekStart,
  week,
  fmtTime,
  onClose,
}: {
  weekStart: string;
  week: ShiftWeek | null;
  fmtTime: (d: Date) => string;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const mounted = useMounted();
  const refresh = useWeekSettingsRefresh();
  const status = weekStatus(new Date(), weekStart, week);
  const closed = status.kind === "closed";

  const [deadlineDraft, setDeadlineDraft] = useState(() =>
    toLocalInput(status.kind === "closed" ? tomorrowAt18() : status.until),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<WriteErrorCode | null>(null);
  const [invalid, setInvalid] = useState(false);

  async function save(deadlineAt: string) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await runIntentAction("shifts.set_week_deadline", { weekStart, deadlineAt });
      if (!mounted.current) return;
      if (res.ok) {
        await refresh(weekStart);
        if (mounted.current) onClose();
      } else {
        setError(res.code);
      }
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  /** The typed time must be in the future (a past one would just close it —
   * that is what "Close now" is for). */
  function saveTyped() {
    const iso = fromLocalInput(deadlineDraft);
    if (iso === null || new Date(iso) <= new Date()) {
      setInvalid(true);
      return;
    }
    void save(iso);
  }

  return (
    <BottomSheet title={t("shifts.weekSettings")} onClose={onClose}>
      <p className="type-label text-muted">{formatWeekRange(dateOf(weekStart), locale)}</p>
      <StatusLine status={status} fmtTime={fmtTime} />
      <WriteErrorBanner code={error} />

      <label className="flex flex-col gap-2xs type-label text-ink">
        {t(closed ? "shifts.reopenAllLabel" : "shifts.deadlineLabel")}
        <input
          type="datetime-local"
          value={deadlineDraft}
          disabled={saving}
          aria-invalid={invalid ? true : undefined}
          onChange={(e) => {
            setDeadlineDraft(e.target.value);
            setInvalid(false);
          }}
          className={`${inputClass} ${invalid ? invalidRing : ""}`}
        />
        {invalid ? (
          <span role="alert" className="type-caption text-danger">
            {t("shifts.mustBeFuture")}
          </span>
        ) : !closed ? (
          <span className="type-caption text-muted">{t("shifts.deadlineDefaultHint")}</span>
        ) : null}
      </label>

      <div className="flex flex-col gap-xs">
        <button
          type="button"
          disabled={saving}
          onClick={saveTyped}
          className="h-11 rounded-pill bg-app-coral px-md type-label text-on-fill interactive motion-safe:active:scale-[0.98]"
        >
          {t(closed ? "shifts.reopenAll" : "shifts.saveDeadline")}
        </button>
        {!closed ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => void save(new Date().toISOString())}
            className="h-11 rounded-pill bg-danger/10 px-md type-label text-danger interactive motion-safe:active:scale-[0.98]"
          >
            {t("shifts.closeNow")}
          </button>
        ) : null}
      </div>
    </BottomSheet>
  );
}

/** "Open until …" / "Closed" / "Reopened until …" — the table's status line too. */
export function StatusLine({
  status,
  fmtTime,
}: {
  status: ReturnType<typeof weekStatus>;
  fmtTime: (d: Date) => string;
}) {
  const { t } = useI18n();
  if (status.kind === "closed") {
    return (
      <span className="flex flex-col">
        <span className="type-label text-danger">{t("shifts.statusClosed")}</span>
        <span className="type-caption text-muted">{t("shifts.deadlineWas").replace("{time}", fmtTime(status.since))}</span>
      </span>
    );
  }
  return (
    <span className={`type-label ${status.kind === "reopened" ? "text-app-coral" : "text-ink"}`}>
      {t(status.kind === "reopened" ? "shifts.statusReopenedUntil" : "shifts.statusOpenUntil").replace(
        "{time}",
        fmtTime(status.until),
      )}
    </span>
  );
}
