"use client";

/**
 * Add / edit a training day — name (required) and type (strength / cardio).
 * The caller runs the write (`onSubmit` returns an error code or null) and
 * patches its cache; the modal only collects and validates.
 */
import { useEffect, useRef, useState } from "react";
import { useI18n, type MessageKey } from "@/i18n";
import { DAY_NAME_MAX, DAY_TYPES, type DayType } from "../logic";
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

export const DAY_TYPE_KEY: Record<DayType, MessageKey> = {
  strength: "training.dayTypeStrength",
  cardio: "training.dayTypeCardio",
};

export interface DayDraft {
  name: string;
  dayType: DayType;
}

export function DayModal({
  titleKey,
  initial,
  onSubmit,
  onClose,
}: {
  titleKey: MessageKey;
  initial: DayDraft;
  onSubmit: (draft: DayDraft) => Promise<WriteErrorCode | null>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const mounted = useMounted();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<DayDraft>(initial);
  const [showRequired, setShowRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [writeError, setWriteError] = useState<WriteErrorCode | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const name = draft.name.trim();
    if (!name) {
      setShowRequired(true);
      return;
    }
    setSubmitting(true);
    setWriteError(null);
    const code = await onSubmit({ name, dayType: draft.dayType });
    if (!mounted.current) return;
    setSubmitting(false);
    if (code) {
      setWriteError(code);
      return;
    }
    onClose();
  }

  return (
    <Modal title={t(titleKey)} onClose={onClose} onSubmit={submit}>
      <WriteErrorBanner code={writeError} />
      <label className="flex flex-col gap-2xs type-label text-muted">
        <FieldLabel label={t("training.dayName")} required />
        <input
          ref={inputRef}
          type="text"
          className={showRequired ? `${inputClass} ${invalidRing}` : inputClass}
          value={draft.name}
          placeholder={t("training.dayNamePlaceholder")}
          maxLength={DAY_NAME_MAX}
          onChange={(e) => {
            setDraft({ ...draft, name: e.target.value });
            if (e.target.value.trim()) setShowRequired(false);
          }}
          aria-required="true"
          aria-invalid={showRequired ? true : undefined}
        />
        {showRequired ? (
          <span role="alert" className="type-caption text-danger">
            {t("training.dayNameRequired")}
          </span>
        ) : null}
      </label>

      <fieldset className="flex flex-col gap-2xs type-label text-muted">
        <legend className="pb-2xs">{t("training.dayType")}</legend>
        <div className="flex gap-2xs">
          {DAY_TYPES.map((type) => {
            const selected = draft.dayType === type;
            return (
              <button
                key={type}
                type="button"
                aria-pressed={selected}
                onClick={() => setDraft({ ...draft, dayType: type })}
                className={`flex-1 rounded-pill py-xs type-label interactive motion-safe:active:scale-[0.97] ${
                  selected ? "bg-app-amber text-on-fill" : "bg-screen text-ink"
                }`}
              >
                {t(DAY_TYPE_KEY[type])}
              </button>
            );
          })}
        </div>
      </fieldset>

      <FormActions
        submitLabel={t("training.save")}
        onCancel={onClose}
        submitting={submitting}
      />
    </Modal>
  );
}
