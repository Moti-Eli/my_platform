"use client";

/**
 * Small view building blocks shared by every shifts screen. COPIED from the
 * orders tool's `views/shared.tsx` (decision: copy, don't share — orders stays
 * untouched), re-keyed to `shifts.*` i18n and the tool's coral accent.
 * Design-system utilities + i18n only.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useI18n, type MessageKey } from "@/i18n";
import type { IntentResult } from "@/cortex/actions";
import { ChevronIcon, CloseIcon, ComposeIcon, InfoIcon } from "@/components/icons";

/** The failure codes a write can come back with (from {@link IntentResult}). */
export type WriteErrorCode = Extract<IntentResult, { ok: false }>["code"];

export const inputClass =
  "w-full rounded-md bg-screen px-sm py-sm type-body text-ink outline-none placeholder:text-muted";
export const invalidRing = "ring-1 ring-danger";

/** Muted placeholder block (token colour; static for reduced-motion users). */
export const SKELETON = "rounded-md bg-hairline motion-safe:animate-pulse";

/** True while mounted — guards setState after an await (StrictMode-safe re-arm). */
export function useMounted() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

/** "1 position" / "4 positions" (and "0 positions"). */
export function useCountLabel() {
  const { t } = useI18n();
  return (n: number, oneKey: MessageKey, manyKey: MessageKey) =>
    n === 1 ? t(oneKey) : `${n} ${t(manyKey)}`;
}

/** Back button + title (+ optional subtitle and trailing action). */
export function ToolHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  const { t, dir } = useI18n();
  const router = useRouter();
  return (
    <div className="flex items-center gap-xs">
      <button
        type="button"
        onClick={() => router.back()}
        aria-label={t("common.back")}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card text-ink interactive motion-safe:active:scale-[0.97]"
      >
        <ChevronIcon style={{ transform: dir === "rtl" ? "scaleX(-1)" : undefined }} />
      </button>
      <div className="flex min-w-0 flex-1 flex-col">
        {subtitle ? <span className="truncate type-label text-muted">{subtitle}</span> : null}
        <h1 className="truncate type-title text-ink">{title}</h1>
      </div>
      {action}
    </div>
  );
}

/** Filled accent pill used for every header "add" action. */
export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-pill bg-app-coral px-md py-xs type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
    >
      {label}
    </button>
  );
}

/** The honest write-failure banner: denied/unavailable vs failed. */
export function WriteErrorBanner({ code }: { code: WriteErrorCode | null }) {
  const { t } = useI18n();
  if (!code) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-xs rounded-md bg-danger/10 px-sm py-xs type-label text-danger"
    >
      <InfoIcon width={18} height={18} aria-hidden className="mt-2xs shrink-0" />
      <span>{t(code === "failed" ? "shifts.errorFailed" : "shifts.errorDenied")}</span>
    </p>
  );
}

/** A centred empty/info card with an optional action under it. */
export function EmptyCard({
  titleKey,
  hintKey,
  action,
}: {
  titleKey: MessageKey;
  hintKey?: MessageKey;
  action?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center gap-xs rounded-lg bg-card px-lg py-2xl text-center">
      <p className="type-heading text-ink">{t(titleKey)}</p>
      {hintKey ? <p className="max-w-[28ch] type-label text-muted">{t(hintKey)}</p> : null}
      {action ? <div className="pt-xs">{action}</div> : null}
    </div>
  );
}

/** Row trailing actions: edit, then a two-tap delete (arm → confirm). */
export function RowActions({
  onEdit,
  confirming,
  onArmDelete,
  onConfirmDelete,
  disabled,
  confirmLabel,
}: {
  onEdit: () => void;
  confirming: boolean;
  onArmDelete: () => void;
  onConfirmDelete: () => void;
  disabled?: boolean;
  /** Text of the armed button; defaults to "Delete?". */
  confirmLabel?: string;
}) {
  const { t } = useI18n();
  const armedText = confirmLabel ?? t("shifts.confirmDelete");
  return (
    <>
      <button
        type="button"
        aria-label={t("shifts.edit")}
        onClick={onEdit}
        disabled={disabled}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-hairline text-muted interactive motion-safe:active:scale-[0.97]"
      >
        <ComposeIcon width={16} height={16} />
      </button>
      {confirming ? (
        <button
          type="button"
          aria-label={armedText}
          onClick={onConfirmDelete}
          disabled={disabled}
          className="shrink-0 rounded-pill bg-danger px-sm py-2xs type-caption text-on-fill interactive motion-safe:active:scale-[0.97]"
        >
          {armedText}
        </button>
      ) : (
        <button
          type="button"
          aria-label={t("shifts.delete")}
          onClick={onArmDelete}
          disabled={disabled}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-hairline text-muted interactive motion-safe:active:scale-[0.97]"
        >
          <CloseIcon width={16} height={16} />
        </button>
      )}
    </>
  );
}

/**
 * Modal shell — same overlay chrome and z-index as tasks' AddTaskModal (scrim at
 * z-[70] clears the TabBar; tap on the scrim or Escape closes). The panel is a
 * <form>, so Enter submits.
 */
export function Modal({
  title,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  children: ReactNode;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="ds-backdrop fixed inset-0 z-[70] flex items-center justify-center bg-scrim p-md"
      onClick={onClose}
    >
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="ds-panel flex max-h-full w-[min(100%,24rem)] flex-col gap-sm overflow-y-auto rounded-xl bg-card p-lg shadow-lifted"
      >
        <h2 className="type-heading text-ink">{title}</h2>
        {children}
      </form>
    </div>
  );
}

/**
 * Same overlay chrome as {@link Modal}, but the panel is a plain <div> — for
 * content that brings its OWN <form> (a form inside Modal's form would nest
 * forms) or has no form at all (a confirmation).
 */
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="ds-backdrop fixed inset-0 z-[70] flex items-center justify-center bg-scrim p-md"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="ds-panel flex max-h-full w-[min(100%,24rem)] flex-col gap-sm overflow-y-auto rounded-xl bg-card p-lg shadow-lifted"
      >
        <h2 className="type-heading text-ink">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Primary + cancel buttons for a modal or inline form. */
export function FormActions({
  submitLabel,
  onCancel,
  submitting,
}: {
  submitLabel: string;
  onCancel: () => void;
  submitting: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="flex gap-sm pt-xs">
      <button
        type="submit"
        disabled={submitting}
        className="flex-1 rounded-md bg-app-coral py-sm type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
      >
        {submitLabel}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={submitting}
        className="flex-1 rounded-md bg-hairline py-sm type-label text-ink interactive motion-safe:active:scale-[0.97]"
      >
        {t("shifts.cancel")}
      </button>
    </div>
  );
}

/** A labelled text input with optional required marker and inline error. */
export function TextField({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  required,
  error,
  inputRef,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  maxLength: number;
  required?: boolean;
  error?: string | null;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  return (
    <label className="flex flex-col gap-2xs type-label text-muted">
      <span>
        {label}
        {required ? (
          <>
            {" "}
            <span aria-hidden="true" className="text-danger">
              *
            </span>
          </>
        ) : null}
      </span>
      <input
        ref={inputRef}
        type="text"
        className={error ? `${inputClass} ${invalidRing}` : inputClass}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        aria-required={required ? "true" : undefined}
        aria-invalid={error ? true : undefined}
      />
      {error ? (
        <span role="alert" className="type-caption text-danger">
          {error}
        </span>
      ) : null}
    </label>
  );
}
