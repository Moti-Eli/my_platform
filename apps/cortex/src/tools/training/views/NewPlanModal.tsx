"use client";

/**
 * "New plan" modal — name (required), description and workouts per week
 * (optional). "Create" runs `training.create_plan` (which creates the plan's own
 * org and installs the tool there), then switches to that org and lands in the
 * new plan.
 *
 * The switch is the same as the org switcher's (and shopping's NewListModal):
 * set ORG_COOKIE, then a FULL document load (never router.push) — the
 * react-query cache is not org-scoped, so a soft navigation would keep the
 * previous org's rows on screen.
 */
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { runIntentAction } from "@/cortex/actions";
import { ORG_COOKIE, setPreferenceCookie } from "@/lib/cookies";
import { FREQUENCY_MAX, FREQUENCY_MIN, PLAN_DESCRIPTION_MAX, PLAN_NAME_MAX } from "../logic";
import { TRAINING_ROUTE } from "../nav";
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

const FREQUENCIES = Array.from(
  { length: FREQUENCY_MAX - FREQUENCY_MIN + 1 },
  (_, i) => FREQUENCY_MIN + i,
);

export function NewPlanModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const mounted = useMounted();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [frequency, setFrequency] = useState<number | null>(null);
  const [showRequired, setShowRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [writeError, setWriteError] = useState<WriteErrorCode | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setShowRequired(true);
      return;
    }
    setSubmitting(true);
    setWriteError(null);
    const res = await runIntentAction("training.create_plan", {
      name: trimmed,
      description: description.trim(),
      frequencyPerWeek: frequency,
    });
    if (!res.ok) {
      if (!mounted.current) return;
      setWriteError(res.code);
      setSubmitting(false);
      return;
    }
    const { orgId } = res.data as { planId: string; orgId: string };
    setPreferenceCookie(ORG_COOKIE, orgId);
    window.location.assign(TRAINING_ROUTE);
  }

  const chip = (selected: boolean) =>
    `flex h-9 min-w-9 items-center justify-center rounded-pill px-sm type-label interactive motion-safe:active:scale-[0.97] ${
      selected ? "bg-app-amber text-on-fill" : "bg-screen text-ink"
    }`;

  return (
    <Modal title={t("training.newPlanTitle")} onClose={onClose} onSubmit={submit}>
      <WriteErrorBanner code={writeError} />

      <label className="flex flex-col gap-2xs type-label text-muted">
        <FieldLabel label={t("training.planName")} required />
        <input
          ref={inputRef}
          type="text"
          className={showRequired ? `${inputClass} ${invalidRing}` : inputClass}
          value={name}
          placeholder={t("training.planNamePlaceholder")}
          maxLength={PLAN_NAME_MAX}
          onChange={(e) => {
            setName(e.target.value);
            if (e.target.value.trim()) setShowRequired(false);
          }}
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
          value={description}
          placeholder={t("training.descriptionPlaceholder")}
          maxLength={PLAN_DESCRIPTION_MAX}
          rows={3}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      <fieldset className="flex flex-col gap-2xs type-label text-muted">
        <legend className="pb-2xs">{t("training.frequency")}</legend>
        <div className="flex flex-wrap gap-2xs">
          <button
            type="button"
            aria-pressed={frequency === null}
            onClick={() => setFrequency(null)}
            className={chip(frequency === null)}
          >
            {t("training.frequencyNone")}
          </button>
          {FREQUENCIES.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={frequency === n}
              onClick={() => setFrequency(n)}
              className={chip(frequency === n)}
            >
              {n}
            </button>
          ))}
        </div>
      </fieldset>

      <FormActions
        submitLabel={t("training.create")}
        onCancel={onClose}
        submitting={submitting}
      />
    </Modal>
  );
}
