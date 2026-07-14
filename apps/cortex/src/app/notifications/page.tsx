"use client";

/**
 * Notifications — an EMPTY placeholder screen reached from the header bell. Just
 * a back control (returns to where you came from — home) and a faint placeholder
 * label; real content is built later. Same back-chevron convention as Settings.
 */
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n";
import { ChevronIcon } from "@/components/icons";

export default function NotificationsPage() {
  const { t, dir } = useI18n();
  const router = useRouter();

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label={t("common.back")}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-ink shadow-soft transition active:scale-95"
        >
          <ChevronIcon style={{ transform: dir === "rtl" ? "scaleX(-1)" : undefined }} />
        </button>
        <h1 className="text-xl font-bold text-ink">{t("notifications.title")}</h1>
      </div>

      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted/60">{t("notifications.empty")}</p>
      </div>
    </>
  );
}
