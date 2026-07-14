"use client";

/**
 * Profile — an EMPTY SHELL with a placeholder "Identity Core" (ליבת זהות) area
 * and a link into Settings. No real content yet; spec'd next.
 */
import Link from "next/link";
import { UserIcon, GearIcon, ChevronIcon } from "@/components/icons";
import { useI18n } from "@/i18n";

export default function ProfilePage() {
  const { t, dir } = useI18n();

  return (
    <>
      <h1 className="px-1 text-xl font-bold text-ink">{t("profile.title")}</h1>

      {/* Identity Core placeholder — structure only. */}
      <section aria-label={t("profile.identityCore")} className="flex flex-col items-center gap-4">
        <div className="flex w-full flex-col items-center gap-4 rounded-xl bg-card px-6 py-10 shadow-soft">
          <span className="flex h-24 w-24 items-center justify-center rounded-full bg-screen text-muted">
            <UserIcon width={44} height={44} />
          </span>
          <p className="text-base font-semibold text-ink">{t("profile.identityCore")}</p>
          <p className="max-w-[26ch] text-center text-sm text-muted">
            {t("profile.identityHint")}
          </p>
          <div className="mt-2 flex w-full flex-col gap-2">
            <div className="h-12 w-full rounded-lg bg-screen" />
            <div className="h-12 w-full rounded-lg bg-screen" />
            <div className="h-12 w-3/4 rounded-lg bg-screen" />
          </div>
        </div>
      </section>

      {/* Settings entry (also reachable from the header gear). */}
      <Link
        href="/settings"
        className="flex items-center justify-between gap-3 rounded-xl bg-card px-4 py-4 shadow-soft transition active:scale-[0.99]"
      >
        <span className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-screen text-indigo">
            <GearIcon />
          </span>
          <span className="text-sm font-semibold text-ink">{t("common.settings")}</span>
        </span>
        <ChevronIcon
          width={20}
          height={20}
          className="text-muted"
          style={{ transform: dir === "rtl" ? "scaleX(-1)" : undefined }}
        />
      </Link>
    </>
  );
}
