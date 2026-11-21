"use client";

/**
 * The plan's three fields — name (required), description, workouts per week —
 * shared by "New plan" and "Edit plan" so both forms look and validate the same.
 * Controlled: the modal owns the values.
 */
import { useI18n } from "@/i18n";
import { FREQUENCY_MAX, FREQUENCY_MIN, PLAN_DESCRIPTION_MAX, PLAN_NAME_MAX } from "../logic";
import { FieldLabel, inputClass, invalidRing } from "./shared";

const FREQUENCIES = Array.from(
  { length: FREQUENCY_MAX - FREQUENCY_MIN + 1 },
  (_, i) => FREQUENCY_MIN + i,
);

export interface PlanDraft {
  name: string;
  description: string;
  frequencyPerWeek: number | null;
}

export function PlanFields({
  value,
  onChange,
  showRequired,
  inputRef,
}: {
  value: PlanDraft;
  onChange: (next: PlanDraft) => void;
  showRequired: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const { t } = useI18n();
  const chip = (selected: boolean) =>
    `flex h-9 min-w-9 items-center justify-center rounded-pill px-sm type-label interactive motion-safe:active:scale-[0.97] ${
      selected ? "bg-app-amber text-on-fill" : "bg-screen text-ink"
    }`;

  return (
    <>
      <label className="flex flex-col gap-2xs type-label text-muted">
        <FieldLabel label={t("training.planName")} required />
        <input
          ref={inputRef}
          type="text"
          className={showRequired ? `${inputClass} ${invalidRing}` : inputClass}
          value={value.name}
          placeholder={t("training.planNamePlaceholder")}
          maxLength={PLAN_NAME_MAX}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          aria-required="true"
          aria-invalid={showRequired ? true : undefined}
        />
        {showRequired ? (
          <span role="alert" className="type-caption text-danger">
            {t("training.planNameRequired")}
          </span>
        ) : null}
      </label>

      <label className="flex flex-col gap-2xs type-label text-muted">
        <FieldLabel label={t("training.description")} />
        <textarea
          className={`${inputClass} min-h-20 resize-none`}
          value={value.description}
          placeholder={t("training.descriptionPlaceholder")}
          maxLength={PLAN_DESCRIPTION_MAX}
          rows={3}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
        />
      </label>

      <fieldset className="flex flex-col gap-2xs type-label text-muted">
        <legend className="pb-2xs">{t("training.frequency")}</legend>
        <div className="flex flex-wrap gap-2xs">
          <button
            type="button"
            aria-pressed={value.frequencyPerWeek === null}
            onClick={() => onChange({ ...value, frequencyPerWeek: null })}
            className={chip(value.frequencyPerWeek === null)}
          >
            {t("training.frequencyNone")}
          </button>
          {FREQUENCIES.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={value.frequencyPerWeek === n}
              onClick={() => onChange({ ...value, frequencyPerWeek: n })}
              className={chip(value.frequencyPerWeek === n)}
            >
              {n}
            </button>
          ))}
        </div>
      </fieldset>
    </>
  );
}
