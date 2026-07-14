"use client";

/**
 * The shared "not built yet" screen for every profile drill-in row: the same
 * fixed top bar (back chevron + title) as the rest of the profile flow, over an
 * empty body with a faint "בקרוב" (coming soon) label. One component, reused by
 * the single `/profile/s/[key]` route — no bespoke pages.
 */
import { Screen } from "./Screen";
import { BackButton } from "./BackButton";
import { useI18n } from "@/i18n";

export function PlaceholderScreen({ title }: { title: string }) {
  const { t } = useI18n();
  return (
    <Screen
      bar={
        <div className="flex items-center gap-2">
          <BackButton />
          <h1 className="flex-1 truncate text-lg font-bold text-ink">{title}</h1>
        </div>
      }
    >
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-sm text-muted">{t("apps.comingSoon")}</p>
      </div>
    </Screen>
  );
}
