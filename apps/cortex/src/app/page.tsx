"use client";

/**
 * Home — an EMPTY SHELL. An app-tabs row placeholder at the top and an empty
 * dashboard area with a "nothing pinned yet" state. No real cards yet; content
 * is spec'd next.
 */
import { AppTabsRow } from "@/components/home/AppTabsRow";
import { EmptyState } from "@/components/EmptyState";
import { PinIcon } from "@/components/icons";
import { useI18n } from "@/i18n";

export default function HomePage() {
  const { t } = useI18n();

  return (
    <>
      <AppTabsRow />

      <section aria-label={t("home.dashboardLabel")} className="flex flex-1 flex-col">
        <EmptyState
          icon={<PinIcon />}
          title={t("home.emptyTitle")}
          hint={t("home.emptyHint")}
        />
      </section>
    </>
  );
}
