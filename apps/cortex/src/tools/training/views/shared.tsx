"use client";

/**
 * Small view building blocks shared by every training screen. COPIED from the
 * shopping tool's `views/shared.tsx` (decision: copy, don't share — as shopping
 * did from shifts), cut to what the training screens use, re-keyed to
 * `training.*` i18n. Design-system utilities + i18n only; amber accent.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useI18n, type MessageKey } from "@/i18n";
import type { IntentResult } from "@/cortex/actions";
import { ChevronIcon, InfoIcon } from "@/components/icons";

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

/** "N workouts a week", or null when not set. */
export function useFrequencyLabel() {
  const { t } = useI18n();
  return (n: number | null): string | null =>
    n == null
      ? null
      : n === 1
        ? t("training.frequencyOne")
        : t("training.frequencyMany").replace("{count}", String(n));
}

/** Back button + title (+ optional subtitle). `onBack` steps up one level
 *  inside the tool; without it, back leaves the tool (router.back()). */
export function ToolHeader({
  title,
  subtitle,
  onBack,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
}) {
  const { t, dir } = useI18n();
  const router = useRouter();
  return (
    <div className="flex items-center gap-xs">
      <button
        type="button"
        onClick={() => (onBack ? onBack() : router.back())}
        aria-label={t("common.back")}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card text-ink interactive motion-safe:active:scale-[0.97]"
      >
        <ChevronIcon style={{ transform: dir === "rtl" ? "scaleX(-1)" : undefined }} />
      </button>
      <div className="flex min-w-0 flex-1 flex-col">
        {subtitle ? <span className="truncate type-label text-muted">{subtitle}</span> : null}
        <h1 className="truncate type-title text-ink">{title}</h1>
      </div>
    </div>
  );
}

/** Filled accent pill used for every "add" action. */
export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-pill bg-app-amber px-md py-xs type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
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
      <span>{t(code === "failed" ? "training.errorFailed" : "training.errorDenied")}</span>
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

/**
 * Modal shell — same overlay chrome and z-index as shopping's Modal (scrim at
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
 * Same overlay chrome as {@link Modal}, but the panel is a plain <div> — for a
 * confirmation (no form).
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

/** Case-insensitive "does `text` contain the search query" (empty query = all). */
export function matchesSearch(text: string, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  return q === "" || text.toLocaleLowerCase().includes(q);
}

/** Primary + cancel buttons for a modal. */
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
        className="flex-1 rounded-md bg-app-amber py-sm type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
      >
        {submitLabel}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={submitting}
        className="flex-1 rounded-md bg-hairline py-sm type-label text-ink interactive motion-safe:active:scale-[0.97]"
      >
        {t("training.cancel")}
      </button>
    </div>
  );
}

/** A field label with an optional required marker. */
export function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
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
  );
}
