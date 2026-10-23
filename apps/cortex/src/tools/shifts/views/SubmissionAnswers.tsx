"use client";

/**
 * The three BUILT-IN questions under the week's shift table (stage 2, part 4):
 *
 *   1. How many shifts this week? — min and max (0–99), max not below min.
 *   2. Open to a double (two shifts in one day)? — yes / no / only if needed.
 *   3. A one-line note to the manager (≤ 200 chars).
 *
 * Every change saves at once (`shifts.set_answers`), like the marks: the
 * segmented choice on tap, the inputs on blur / Enter. Min and max always travel
 * TOGETHER, so the pair rule is validated once (here, in the intent, in the DB).
 * A save patches the shared week cache (fields + updatedAt), so the screen's
 * "changes not submitted yet" line reacts the same way it does for marks.
 *
 * Locked (`open === false`) = every control disabled, nothing is sent. The
 * manager's own questions (part 7) will render below these.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { runIntentAction } from "@/cortex/actions";
import type { DoubleShift, MyWeek, Submission } from "../logic";
import { SHIFTS_COUNT_MAX, SUBMISSION_NOTE_MAX } from "../intents";
import { myWeekKey } from "@/lib/query/useShiftAvailability";
import { inputClass, invalidRing, useMounted, type WriteErrorCode } from "./shared";

const DOUBLE: DoubleShift[] = ["yes", "no", "if_needed"];

type AnswersPatch = Partial<Pick<Submission, "minShifts" | "maxShifts" | "doubleShift" | "note">>;

export function SubmissionAnswers({
  weekStart,
  submission,
  open,
  onError,
}: {
  weekStart: string;
  /** null until the first save creates the row. */
  submission: Submission | null;
  open: boolean;
  onError: (code: WriteErrorCode | null) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const mounted = useMounted();
  const [saving, setSaving] = useState(false);

  // Local drafts for the typed fields (saved on blur / Enter). The parent keys
  // this component by the saved values, so a server change (another device, a
  // refetch) remounts it with fresh drafts — no effect needed.
  const [minDraft, setMinDraft] = useState(numToText(submission?.minShifts));
  const [maxDraft, setMaxDraft] = useState(numToText(submission?.maxShifts));
  const [noteDraft, setNoteDraft] = useState(submission?.note ?? "");
  const [rangeError, setRangeError] = useState<"range" | "minMax" | null>(null);

  async function save(patch: AnswersPatch) {
    if (!open || saving) return;
    setSaving(true);
    onError(null);
    try {
      const res = await runIntentAction("shifts.set_answers", { weekStart, ...patch });
      if (res.ok) {
        const { submissionId, updatedAt } = res.data as { submissionId: string; updatedAt: string };
        queryClient.setQueryData<MyWeek>(myWeekKey(weekStart), (prev) =>
          prev
            ? {
                ...prev,
                submission: {
                  ...(prev.submission ?? emptySubmission(submissionId, weekStart)),
                  ...patch,
                  updatedAt,
                },
              }
            : prev,
        );
      } else if (mounted.current) {
        onError(res.code);
        if (res.code === "weekClosed") {
          void queryClient.invalidateQueries({ queryKey: myWeekKey(weekStart) });
        }
      }
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  /** Min/max: parse both drafts, validate the pair, send both. */
  function commitRange() {
    const min = parseCount(minDraft);
    const max = parseCount(maxDraft);
    if (min === undefined || max === undefined) {
      setRangeError("range");
      return;
    }
    if (min !== null && max !== null && max < min) {
      setRangeError("minMax");
      return;
    }
    setRangeError(null);
    if (min === (submission?.minShifts ?? null) && max === (submission?.maxShifts ?? null)) return;
    void save({ minShifts: min, maxShifts: max });
  }

  function commitNote() {
    const clean = noteDraft.replace(/\s+/g, " ").trim().slice(0, SUBMISSION_NOTE_MAX);
    setNoteDraft(clean);
    if (clean === (submission?.note ?? "")) return;
    void save({ note: clean });
  }

  const disabled = !open || saving;
  const dim = !open ? "opacity-[var(--ds-disabled-opacity)]" : "";

  return (
    <section aria-label={t("shifts.questionsTitle")} className={`flex flex-col gap-md rounded-lg bg-card p-md ${dim}`}>
      <h2 className="type-heading text-ink">{t("shifts.questionsTitle")}</h2>

      {/* 1. How many shifts — min / max. */}
      <div className="flex flex-col gap-xs">
        <span className="type-label text-ink">{t("shifts.qShiftsCount")}</span>
        <div className="flex gap-sm">
          {(
            [
              ["min", minDraft, setMinDraft, "shifts.qMin"],
              ["max", maxDraft, setMaxDraft, "shifts.qMax"],
            ] as const
          ).map(([key, value, setValue, labelKey]) => (
            <label key={key} className="flex flex-1 flex-col gap-2xs type-caption text-muted">
              {t(labelKey)}
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={value}
                disabled={disabled}
                maxLength={2}
                aria-invalid={rangeError ? true : undefined}
                onChange={(e) => {
                  setValue(e.target.value.replace(/\D/g, ""));
                  setRangeError(null);
                }}
                onBlur={commitRange}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                className={`${inputClass} text-center ${rangeError ? invalidRing : ""}`}
              />
            </label>
          ))}
        </div>
        {rangeError ? (
          <span role="alert" className="type-caption text-danger">
            {t(rangeError === "minMax" ? "shifts.minMaxError" : "shifts.numberRange")}
          </span>
        ) : null}
      </div>

      {/* 2. Double shift — segmented. */}
      <div className="flex flex-col gap-xs">
        <span className="type-label text-ink">{t("shifts.qDouble")}</span>
        <div role="radiogroup" aria-label={t("shifts.qDouble")} className="grid grid-cols-3 gap-2xs">
          {DOUBLE.map((v) => {
            const active = submission?.doubleShift === v;
            return (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={disabled}
                onClick={() => {
                  if (!active) void save({ doubleShift: v });
                }}
                className={`flex h-10 items-center justify-center rounded-pill px-xs type-label interactive motion-safe:active:scale-[0.97] ${
                  active ? "bg-app-coral text-on-fill" : "bg-screen text-ink"
                }`}
              >
                {t(v === "yes" ? "shifts.dblYes" : v === "no" ? "shifts.dblNo" : "shifts.dblIfNeeded")}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Note — one line. */}
      <label className="flex flex-col gap-2xs type-label text-ink">
        <span className="flex items-baseline justify-between gap-sm">
          {t("shifts.qNote")}
          <span className="type-caption text-muted" dir="ltr">
            {noteDraft.length}/{SUBMISSION_NOTE_MAX}
          </span>
        </span>
        <input
          type="text"
          value={noteDraft}
          disabled={disabled}
          maxLength={SUBMISSION_NOTE_MAX}
          placeholder={t("shifts.notePlaceholder")}
          onChange={(e) => setNoteDraft(e.target.value)}
          onBlur={commitNote}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className={inputClass}
        />
      </label>
    </section>
  );
}

function numToText(n: number | null | undefined): string {
  return n == null ? "" : String(n);
}

/** "" → null (not answered); "0"–"99" → the number; anything else → undefined (invalid). */
function parseCount(text: string): number | null | undefined {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= 0 && n <= SHIFTS_COUNT_MAX ? n : undefined;
}

function emptySubmission(id: string, weekStart: string): Submission {
  return {
    id,
    employeeId: "",
    weekStart,
    minShifts: null,
    maxShifts: null,
    doubleShift: null,
    note: "",
    answers: {},
    submittedAt: null,
    updatedAt: "",
  };
}
