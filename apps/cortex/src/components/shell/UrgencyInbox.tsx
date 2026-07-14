"use client";

/**
 * The urgency inbox — "מה דחוף היום". An EMPTY SHELL: a panel that drops from the
 * top with a calm empty state. No items/data source yet.
 */
import { useEffect } from "react";
import { BellIcon, CloseIcon } from "@/components/icons";
import { EmptyState } from "@/components/EmptyState";
import { useI18n } from "@/i18n";

export function UrgencyInbox({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={t("urgency.title")}
    >
      <button
        type="button"
        aria-label={t("common.close")}
        onClick={onClose}
        className="ds-backdrop absolute inset-0 bg-ink/30"
      />

      <div className="ds-panel relative z-10 mt-3 w-full max-w-[480px] px-3">
        <div className="rounded-xl bg-card p-5 shadow-lifted">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-coral/15 text-coral">
                <BellIcon width={20} height={20} />
              </span>
              <h2 className="text-base font-bold text-ink">{t("urgency.title")}</h2>
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

          <EmptyState
            icon={<BellIcon />}
            title={t("urgency.emptyTitle")}
            hint={t("urgency.emptyHint")}
          />
        </div>
      </div>
    </div>
  );
}
