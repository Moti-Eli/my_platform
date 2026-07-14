"use client";

/**
 * "כל הכלים" (catalog) — placeholder empty screen (slot 2). Real tool catalog
 * comes later.
 */
import { EmptyState } from "@/components/EmptyState";
import { GridIcon } from "@/components/icons";
import { useI18n } from "@/i18n";

export default function CatalogPage() {
  const { t } = useI18n();

  return (
    <>
      <h1 className="px-1 text-xl font-bold text-ink">{t("catalog.title")}</h1>
      <section className="flex flex-1 flex-col">
        <EmptyState
          icon={<GridIcon />}
          title={t("catalog.emptyTitle")}
          hint={t("catalog.emptyHint")}
        />
      </section>
    </>
  );
}
