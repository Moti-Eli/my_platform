"use client";

/**
 * The urgency inbox — "מה דחוף היום". A panel that drops from the top with a
 * vertical stack of notification cards (scrolling if they overflow), or a calm
 * empty state when there are none.
 *
 * Data comes ONLY from {@link useNotifications} (the swap-in seam). Each card is
 * app-centric: its `appId` is resolved to icon/name/route via the registry
 * ({@link useRegisteredApps}) — nothing here hard-codes an app's name or icon.
 * Tapping a card opens that app and closes the inbox.
 */
import { useEffect } from "react";
import Link from "next/link";
import { appRoute, useRegisteredApps } from "@/cortex/apps";
import { appIcon, appColorClasses } from "@/components/app-visuals";
import { BellIcon, CloseIcon } from "@/components/icons";
import { EmptyState } from "@/components/EmptyState";
import { useI18n, type MessageKey } from "@/i18n";
import { useNotifications } from "./useNotifications";

/** Localized relative time ("8 minutes ago" / "לפני 8 דקות"), locale-driven. */
function relativeTime(timestamp: number, locale: string): string {
  const diff = timestamp - Date.now();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const minutes = Math.round(diff / 60_000);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  const hours = Math.round(diff / 3_600_000);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
  return rtf.format(Math.round(diff / 86_400_000), "day");
}

export function UrgencyInbox({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, locale } = useI18n();
  const store = useNotifications();
  const apps = useRegisteredApps();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const notifications = store.listNotifications();
  const byId = new Map(apps.map((manifest) => [manifest.id, manifest]));
  // Resolve each notification's app via the registry; skip any whose app isn't
  // registered rather than invent an icon/name.
  const cards = notifications.flatMap((n) => {
    const manifest = byId.get(n.appId);
    return manifest ? [{ n, manifest }] : [];
  });

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
        className="ds-backdrop absolute inset-0 bg-scrim"
      />

      <div className="ds-panel relative z-10 mt-3 w-full max-w-[480px] px-3">
        <div className="flex max-h-[80dvh] flex-col rounded-2xl bg-screen p-3 shadow-lifted">
          <div className="mb-2 flex shrink-0 items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-danger/15 text-danger">
                <BellIcon width={20} height={20} />
              </span>
              <h2 className="type-heading text-ink">{t("urgency.title")}</h2>
            </div>
            <button
              type="button"
              aria-label={t("common.close")}
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-card text-muted touch-manipulation transition active:transition-none active:bg-hairline motion-safe:active:scale-95"
            >
              <CloseIcon width={18} height={18} />
            </button>
          </div>

          {notifications.length === 0 ? (
            <EmptyState
              icon={<BellIcon />}
              title={t("urgency.emptyTitle")}
              hint={t("urgency.emptyHint")}
            />
          ) : (
            <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
              {cards.map(({ n, manifest }) => {
                const Icon = appIcon(manifest.icon);
                return (
                  <Link
                    key={n.id}
                    href={appRoute(n.appId)}
                    onClick={onClose}
                    className="block rounded-xl bg-card p-3.5 shadow-soft touch-manipulation transition active:transition-none active:opacity-90 motion-safe:active:scale-[0.98]"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${appColorClasses(manifest.color)}`}
                      >
                        <Icon width={18} height={18} />
                      </span>
                      <span className="truncate type-label text-ink">
                        {t(manifest.name.key as MessageKey)}
                      </span>
                      <span className="ms-auto shrink-0 type-caption text-muted">
                        {relativeTime(n.timestamp, locale)}
                      </span>
                    </div>
                    <p className="mt-1.5 truncate type-heading text-ink">
                      {t(n.title as MessageKey)}
                    </p>
                    <p className="mt-0.5 truncate type-label text-muted">
                      {t(n.description as MessageKey)}
                    </p>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
