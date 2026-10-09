"use client";

/**
 * The shift fields — name, start time, end time — shared by the "add shift"
 * modal and the shift edit screen, so add and edit can never drift apart.
 *
 * Validation, visible on submit: name required; both times required; start and
 * end must differ; the name must not repeat on the same day (the DB refuses it
 * too — this gives a clear message instead of the generic failure). An end time
 * earlier than the start shows "Ends the next day" live.
 */
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import type { ShiftTemplate } from "../logic";
import { SHIFT_NAME_MAX } from "../intents";
import { isOvernight } from "../time";
import { TimePanel, TimeTrigger } from "./TimePicker";
import {
  FormActions,
  TextField,
  WriteErrorBanner,
  useMounted,
  type WriteErrorCode,
} from "./shared";

export interface ShiftDraft {
  name: string;
  startTime: string;
  endTime: string;
}

/** Case/space-insensitive name match. */
function sameName(a: string, b: string, locale: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  return norm(a).localeCompare(norm(b), locale, { sensitivity: "base" }) === 0;
}

export function ShiftFields({
  initial,
  dayShifts,
  editingId,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: ShiftDraft;
  /** The OTHER shifts on the same day — for the duplicate-name check. */
  dayShifts: readonly ShiftTemplate[];
  /** The shift being edited (excluded from the duplicate check). */
  editingId?: string;
  submitLabel: string;
  /** Performs the write; resolves to the failure code or null. */
  onSubmit: (draft: ShiftDraft) => Promise<WriteErrorCode | null>;
  onCancel: () => void;
}) {
  const { t, locale } = useI18n();
  const mounted = useMounted();
  const [draft, setDraft] = useState<ShiftDraft>(initial);
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<WriteErrorCode | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const name = draft.name.replace(/\s+/g, " ").trim();
  const nameMissing = name === "";
  const duplicate =
    !nameMissing && dayShifts.some((s) => s.id !== editingId && sameName(s.name, name, locale));
  const startMissing = draft.startTime === "";
  const endMissing = draft.endTime === "";
  const same = !startMissing && !endMissing && draft.startTime === draft.endTime;
  const overnight = !startMissing && !endMissing && isOvernight(draft.startTime, draft.endTime);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setShowErrors(true);
    if (nameMissing || duplicate || startMissing || endMissing || same || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const code = await onSubmit({ name, startTime: draft.startTime, endTime: draft.endTime });
      if (!mounted.current) return;
      if (code) setError(code);
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  // Which time field's picker is open (one at a time, shown under both fields).
  const [openField, setOpenField] = useState<"startTime" | "endTime" | null>(null);

  const timeField = (key: "startTime" | "endTime", labelKey: "shifts.startTime" | "shifts.endTime") => {
    const missing = key === "startTime" ? startMissing : endMissing;
    return (
      <TimeTrigger
        label={t(labelKey)}
        value={draft[key]}
        open={openField === key}
        invalid={showErrors && (missing || (key === "endTime" && same))}
        onToggle={() => setOpenField((cur) => (cur === key ? null : key))}
      />
    );
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-sm">
      <WriteErrorBanner code={error} />
      <TextField
        label={t("shifts.shiftName")}
        value={draft.name}
        onChange={(v) => setDraft((d) => ({ ...d, name: v }))}
        placeholder={t("shifts.shiftNamePlaceholder")}
        maxLength={SHIFT_NAME_MAX}
        required
        error={
          showErrors && nameMissing
            ? t("shifts.fieldRequired")
            : showErrors && duplicate
              ? t("shifts.shiftNameExists")
              : null
        }
        inputRef={nameRef}
      />
      <div className="flex gap-sm">
        {timeField("startTime", "shifts.startTime")}
        {timeField("endTime", "shifts.endTime")}
      </div>
      {openField ? (
        <TimePanel
          // Re-mount per field so each opens scrolled to its own value.
          key={openField}
          value={draft[openField]}
          onChange={(v) => setDraft((d) => ({ ...d, [openField]: v }))}
          onDone={() => setOpenField(null)}
        />
      ) : null}
      {showErrors && (startMissing || endMissing) ? (
        <span role="alert" className="type-caption text-danger">
          {t("shifts.timeRequired")}
        </span>
      ) : showErrors && same ? (
        <span role="alert" className="type-caption text-danger">
          {t("shifts.sameTimes")}
        </span>
      ) : overnight ? (
        <span className="type-caption text-app-coral">{t("shifts.endsNextDay")}</span>
      ) : null}
      <FormActions submitLabel={submitLabel} onCancel={onCancel} submitting={submitting} />
    </form>
  );
}
