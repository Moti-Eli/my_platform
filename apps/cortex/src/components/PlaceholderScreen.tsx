"use client";

/**
 * TEMPORARY placeholder sub-app screen — a title (icon + name) plus dummy filler
 * cards, enough to overflow the viewport so the header + chips row can be seen
 * scrolling up and off while the tab bar stays fixed. No real logic or data.
 * Driven by {@link PLACEHOLDER_APPS}; delete once real tools land.
 */
import { useI18n } from "@/i18n";
import { PLACEHOLDER_APPS } from "@/lib/placeholder-apps";

export function PlaceholderScreen({ appId }: { appId: string }) {
  const { t } = useI18n();
  const app = PLACEHOLDER_APPS.find((a) => a.id === appId);
  if (!app) return null;
  const { Icon } = app;

  return (
    <>
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-indigo/15 text-indigo">
          <Icon width={22} height={22} />
        </span>
        <div className="flex flex-col">
          <h1 className="text-xl font-bold text-ink">{t(app.labelKey)}</h1>
          <p className="text-xs text-muted">{t("placeholders.comingSoon")}</p>
        </div>
      </div>

      {/* Dummy filler — repeated skeleton cards to overflow the viewport. */}
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="rounded-xl bg-card p-4 shadow-soft">
          <div className="mb-2 h-4 w-1/2 rounded-full bg-screen" />
          <div className="mb-1.5 h-3 w-full rounded-full bg-screen" />
          <div className="h-3 w-3/4 rounded-full bg-screen" />
        </div>
      ))}
    </>
  );
}
