"use client";

/**
 * Placeholder for the Home "app tabs" row — the horizontal strip that will let
 * you switch between pinned tools. For now it renders inert skeleton pills (no
 * tools exist yet). Purely presentational.
 */
import { useI18n } from "@/i18n";

export function AppTabsRow() {
  const { t } = useI18n();

  return (
    <div
      className="flex gap-2 overflow-x-auto pb-1"
      aria-label={t("home.appTabsLabel")}
      role="tablist"
      aria-hidden
    >
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-9 w-24 shrink-0 rounded-pill bg-card shadow-soft"
          style={{ opacity: 1 - i * 0.18 }}
        />
      ))}
    </div>
  );
}
