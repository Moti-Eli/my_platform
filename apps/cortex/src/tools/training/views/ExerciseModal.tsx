"use client";

/**
 * Add / edit an exercise — name (required), sets, reps (free text: "8-12"),
 * target weight in kg, rest in seconds, notes. The number fields are optional:
 * empty = not set. A value outside the table's CHECK range is caught here with
 * an inline message, before anything is sent. The caller runs the write
 * (`onSubmit` returns an error code or null) and patches its cache.
 */
import { useEffect, useRef, useState } from "react";
import { useI18n, type MessageKey } from "@/i18n";
import {
  EXERCISE_NAME_MAX,
  NOTES_MAX,
  REPS_MAX,
  REST_MAX,
  SETS_MAX,
  SETS_MIN,
  WEIGHT_MAX,
  type Exercise,
  type ExerciseFields,
} from "../logic";
import {
  FieldLabel,
  FormActions,
  Modal,
  WriteErrorBanner,
  inputClass,
  invalidRing,
  useMounted,
  type WriteErrorCode,
} from "./shared";

interface Draft {
  name: string;
  sets: string;
  reps: string;
  weight: string;
  rest: string;
  notes: string;
}

type NumberField = "sets" | "weight" | "rest";

function toDraft(e: Exercise | null): Draft {
  return {
    name: e?.name ?? "",
    sets: e?.sets == null ? "" : String(e.sets),
    reps: e?.reps ?? "",
    weight: e?.targetWeight == null ? "" : String(e.targetWeight),
    rest: e?.restSeconds == null ? "" : String(e.restSeconds),
    notes: e?.notes ?? "",
  };
}

/** "" → null; a number in [min, max] (integer when asked) → it; else undefined
 *  (= invalid). Accepts a comma as the decimal point. */
function parseNumber(
  raw: string,
  { min, max, integer }: { min: number; max: number; integer: boolean },
): number | null | undefined {
  const s = raw.trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < min || n > max) return undefined;
  if (integer && !Number.isInteger(n)) return undefined;
  return integer ? n : Math.round(n * 100) / 100;
}

export function ExerciseModal({
  titleKey,
  initial,
  onSubmit,
  onClose,
}: {
  titleKey: MessageKey;
  /** null = a new exercise. */
  initial: Exercise | null;
  onSubmit: (fields: ExerciseFields) => Promise<WriteErrorCode | null>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const mounted = useMounted();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
  const [showRequired, setShowRequired] = useState(false);
  const [invalid, setInvalid] = useState<Set<NumberField>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [writeError, setWriteError] = useState<WriteErrorCode | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function set<K extends keyof Draft>(key: K, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
    if (key === "name" && value.trim()) setShowRequired(false);
    if (key === "sets" || key === "weight" || key === "rest") {
      setInvalid((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const name = draft.name.trim();
    const sets = parseNumber(draft.sets, { min: SETS_MIN, max: SETS_MAX, integer: true });
    const weight = parseNumber(draft.weight, { min: 0, max: WEIGHT_MAX, integer: false });
    const rest = parseNumber(draft.rest, { min: 0, max: REST_MAX, integer: true });
    const bad = new Set<NumberField>();
    if (sets === undefined) bad.add("sets");
    if (weight === undefined) bad.add("weight");
    if (rest === undefined) bad.add("rest");
    setShowRequired(!name);
    setInvalid(bad);
    if (!name || sets === undefined || weight === undefined || rest === undefined) return;

    setSubmitting(true);
    setWriteError(null);
    const code = await onSubmit({
      name,
      sets,
      reps: draft.reps.trim(),
      targetWeight: weight,
      restSeconds: rest,
      notes: draft.notes.trim(),
    });
    if (!mounted.current) return;
    setSubmitting(false);
    if (code) {
      setWriteError(code);
      return;
    }
    onClose();
  }

  const numberInput = (
    field: NumberField,
    labelKey: MessageKey,
    placeholderKey: MessageKey,
    errorKey: MessageKey,
    decimal: boolean,
  ) => (
    <label className="flex min-w-0 flex-1 flex-col gap-2xs type-label text-muted">
      <FieldLabel label={t(labelKey)} />
      <input
        type="text"
        inputMode={decimal ? "decimal" : "numeric"}
        className={invalid.has(field) ? `${inputClass} ${invalidRing}` : inputClass}
        value={draft[field]}
        placeholder={t(placeholderKey)}
        maxLength={8}
        onChange={(e) => set(field, e.target.value)}
        aria-invalid={invalid.has(field) ? true : undefined}
      />
      {invalid.has(field) ? (
        <span role="alert" className="type-caption text-danger">
          {t(errorKey)}
        </span>
      ) : null}
    </label>
  );

  return (
    <Modal title={t(titleKey)} onClose={onClose} onSubmit={submit}>
      <WriteErrorBanner code={writeError} />

      <label className="flex flex-col gap-2xs type-label text-muted">
        <FieldLabel label={t("training.exerciseName")} required />
        <input
          ref={inputRef}
          type="text"
          className={showRequired ? `${inputClass} ${invalidRing}` : inputClass}
          value={draft.name}
          placeholder={t("training.exerciseNamePlaceholder")}
          maxLength={EXERCISE_NAME_MAX}
          onChange={(e) => set("name", e.target.value)}
          aria-required="true"
          aria-invalid={showRequired ? true : undefined}
        />
        {showRequired ? (
          <span role="alert" className="type-caption text-danger">
            {t("training.exerciseNameRequired")}
          </span>
        ) : null}
      </label>

      <div className="flex gap-sm">
        {numberInput("sets", "training.sets", "training.setsPlaceholder", "training.setsInvalid", false)}
        <label className="flex min-w-0 flex-1 flex-col gap-2xs type-label text-muted">
          <FieldLabel label={t("training.reps")} />
          <input
            type="text"
            className={inputClass}
            value={draft.reps}
            placeholder={t("training.repsPlaceholder")}
            maxLength={REPS_MAX}
            onChange={(e) => set("reps", e.target.value)}
          />
        </label>
      </div>

      <div className="flex gap-sm">
        {numberInput(
          "weight",
          "training.targetWeight",
          "training.targetWeightPlaceholder",
          "training.weightInvalid",
          true,
        )}
        {numberInput("rest", "training.rest", "training.restPlaceholder", "training.restInvalid", false)}
      </div>

      <label className="flex flex-col gap-2xs type-label text-muted">
        <FieldLabel label={t("training.notes")} />
        <textarea
          className={`${inputClass} min-h-16 resize-none`}
          value={draft.notes}
          placeholder={t("training.notesPlaceholder")}
          maxLength={NOTES_MAX}
          rows={2}
          onChange={(e) => set("notes", e.target.value)}
        />
      </label>

      <FormActions submitLabel={t("training.save")} onCancel={onClose} submitting={submitting} />
    </Modal>
  );
}
