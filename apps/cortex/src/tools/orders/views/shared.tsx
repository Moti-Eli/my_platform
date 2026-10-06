"use client";

/**
 * Small view building blocks shared by every orders screen, so the levels, the
 * suppliers manager and their modals look and behave identically. Design-system
 * utilities + i18n only.
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

/**
 * A ref that is true while mounted — guards setState after an await. Re-armed on
 * every (re)mount so StrictMode's mount → cleanup → mount doesn't leave it false.
 */
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
      className="shrink-0 rounded-pill bg-app-green px-md py-xs type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
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
      <span>{t(code === "failed" ? "orders.errorFailed" : "orders.errorDenied")}</span>
    </p>
  );
}

/** A dismissible success/info line, in the same spot as the error banner. */
export function NoticeBanner({ text, onClose }: { text: string | null; onClose: () => void }) {
  const { t } = useI18n();
  if (!text) return null;
  return (
    <p
      role="status"
      className="flex items-center gap-xs rounded-md bg-app-green/15 px-sm py-xs type-label text-app-green"
    >
      <span className="min-w-0 flex-1">{text}</span>
      <button
        type="button"
        aria-label={t("orders.closeNotice")}
        onClick={onClose}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full interactive"
      >
        <CloseIcon width={14} height={14} />
      </button>
    </p>
  );
}

/** "1 product" / "4 products" (and "0 products") — a singular key for exactly one. */
export function useCountLabel() {
  const { t } = useI18n();
  return (n: number, oneKey: MessageKey, manyKey: MessageKey) =>
    n === 1 ? t(oneKey) : `${n} ${t(manyKey)}`;
}

/** A tappable list row that drills one level down. */
export function NavRow({
  title,
  meta,
  onOpen,
  children,
}: {
  title: string;
  /** Trailing muted text, e.g. a count. */
  meta?: string;
  onOpen: () => void;
  /** Extra trailing controls (edit/delete). */
  children?: ReactNode;
}) {
  const { dir } = useI18n();
  return (
    <div className="flex items-center gap-sm py-sm">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-sm text-start interactive motion-safe:active:scale-[0.99]"
      >
        <span className="min-w-0 flex-1 truncate type-heading text-ink">{title}</span>
        {meta ? <span className="shrink-0 type-label text-muted">{meta}</span> : null}
        <ChevronIcon
          width={16}
          height={16}
          aria-hidden
          className="shrink-0 text-muted"
          // The chevron points "forward": left in RTL, right in LTR (the icon's
          // native direction is the back arrow, as in ToolHeader).
          style={{ transform: dir === "rtl" ? undefined : "scaleX(-1)" }}
        />
      </button>
      {children}
    </div>
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
  confirmLabel,
  disabled,
  deleteDisabled,
}: {
  onEdit: () => void;
  confirming: boolean;
  onArmDelete: () => void;
  onConfirmDelete: () => void;
  /** Text of the armed button — e.g. "Delete?" or "Delete? 4 products too". */
  confirmLabel: string;
  disabled?: boolean;
  /** Delete is not allowed (e.g. a category still in use): the button is DIMMED
   * but stays tappable, so `onArmDelete` can explain why instead of arming. */
  deleteDisabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <>
      <button
        type="button"
        aria-label={t("orders.edit")}
        onClick={onEdit}
        disabled={disabled}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-hairline text-muted interactive motion-safe:active:scale-[0.97]"
      >
        <ComposeIcon width={16} height={16} />
      </button>
      {confirming ? (
        <button
          type="button"
          aria-label={confirmLabel}
          onClick={onConfirmDelete}
          disabled={disabled}
          className="shrink-0 rounded-pill bg-danger px-sm py-2xs type-caption text-on-fill interactive motion-safe:active:scale-[0.97]"
        >
          {confirmLabel}
        </button>
      ) : (
        <button
          type="button"
          aria-label={t("orders.delete")}
          onClick={onArmDelete}
          disabled={disabled}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-hairline text-muted interactive motion-safe:active:scale-[0.97] ${
            deleteDisabled ? "opacity-[var(--ds-disabled-opacity)]" : ""
          }`}
        >
          <CloseIcon width={16} height={16} />
        </button>
      )}
    </>
  );
}

/**
 * Modal shell — same overlay chrome and z-index as tasks' AddTaskModal (scrim at
 * z-[70] clears the TabBar; tap on the scrim or Escape closes; the panel stops
 * propagation). The panel is a <form>, so Enter submits.
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
        className="flex-1 rounded-md bg-app-green py-sm type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
      >
        {submitLabel}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={submitting}
        className="flex-1 rounded-md bg-hairline py-sm type-label text-ink interactive motion-safe:active:scale-[0.97]"
      >
        {t("orders.cancel")}
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
  type,
  dir,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  maxLength: number;
  required?: boolean;
  /** Message shown under the field (and a red ring) when set. */
  error?: string | null;
  inputRef?: React.Ref<HTMLInputElement>;
  type?: "text" | "tel" | "email";
  dir?: "ltr";
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
        type={type ?? "text"}
        dir={dir}
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

/** A labelled <select> over a list of options (value '' = the placeholder). */
export function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
  required,
  error,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder: string;
  required?: boolean;
  error?: string | null;
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
      <select
        className={error ? `${inputClass} ${invalidRing}` : inputClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-required={required ? "true" : undefined}
        aria-invalid={error ? true : undefined}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error ? (
        <span role="alert" className="type-caption text-danger">
          {error}
        </span>
      ) : null}
    </label>
  );
}
