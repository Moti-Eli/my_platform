"use client";

/**
 * "צ'אט" (comms) — placeholder empty screen (slot 4). Real communications come
 * later.
 */
import { EmptyState } from "@/components/EmptyState";
import { ChatIcon } from "@/components/icons";
import { useI18n } from "@/i18n";

export default function CommsPage() {
  const { t } = useI18n();

  return (
    <>
      <h1 className="px-1 text-xl font-bold text-ink">{t("comms.title")}</h1>
      <section className="flex flex-1 flex-col">
        <EmptyState
          icon={<ChatIcon />}
          title={t("comms.emptyTitle")}
          hint={t("comms.emptyHint")}
        />
      </section>
    </>
  );
}
