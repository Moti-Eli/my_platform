"use client";

/**
 * The AI hero sheet — an EMPTY SHELL for now. It renders the bottom-sheet UI
 * (handle, prompt input, send affordance, placeholder) but makes NO model call.
 * `handleSubmit` is a stub; a later prompt wires it to the shell's data-layer
 * (`runIntent`) so the assistant can act through the one door.
 */
import { useEffect, useState } from "react";
import { SparkIcon, SendIcon, CloseIcon } from "@/components/icons";
import { useI18n } from "@/i18n";

export function AiSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // STUB: no model call yet. Will later call runIntent(...) via cortex-core.
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={t("tabs.ai")}
    >
      <button
        type="button"
        aria-label={t("common.close")}
        onClick={onClose}
        className="ds-backdrop absolute inset-0 bg-ink/30"
      />

      <div className="ds-sheet relative z-10 w-full max-w-[480px] rounded-t-xl bg-card px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3 shadow-lifted">
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-pill bg-hairline" />

        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo text-white">
              <SparkIcon width={20} height={20} />
            </span>
            <h2 className="text-base font-bold text-ink">{t("ai.title")}</h2>
          </div>
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-screen text-muted transition active:scale-95"
          >
            <CloseIcon width={18} height={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={1}
            placeholder={t("ai.placeholder")}
            className="min-h-12 flex-1 resize-none rounded-lg bg-screen px-4 py-3 text-sm text-ink outline-none placeholder:text-muted"
          />
          <button
            type="submit"
            aria-label={t("common.send")}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-indigo text-white shadow-soft transition active:scale-95"
          >
            <SendIcon width={20} height={20} />
          </button>
        </form>

        <p className="mt-3 text-center text-xs text-muted">{t("ai.notConnected")}</p>
      </div>
    </div>
  );
}
