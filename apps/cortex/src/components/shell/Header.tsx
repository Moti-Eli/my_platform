"use client";

/**
 * The shell header: logo + wordmark, a settings gear, a (stub) search button,
 * and the urgency bell (leading edge in RTL). The gear links to Settings; the
 * bell opens the urgency inbox.
 */
import Link from "next/link";
import { BrainLogo } from "@/components/BrainLogo";
import { SearchIcon, BellIcon, GearIcon } from "@/components/icons";
import { useI18n } from "@/i18n";

export function Header({ onOpenInbox }: { onOpenInbox: () => void }) {
  const { t } = useI18n();

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-3 bg-screen/90 px-5 py-4 backdrop-blur">
      <div className="flex items-center gap-2">
        <Link
          href="/settings"
          aria-label={t("common.settings")}
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-card text-indigo shadow-soft transition active:scale-95"
        >
          <BrainLogo />
        </Link>
        <span className="text-lg font-bold tracking-tight text-ink">Cortex</span>
      </div>

      <div className="flex items-center gap-2">
        <Link
          href="/settings"
          aria-label={t("common.settings")}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-ink shadow-soft transition active:scale-95"
        >
          <GearIcon />
        </Link>
        <button
          type="button"
          aria-label={t("common.search")}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-ink shadow-soft transition active:scale-95"
        >
          <SearchIcon />
        </button>
        <button
          type="button"
          aria-label={t("urgency.title")}
          onClick={onOpenInbox}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-coral shadow-soft transition active:scale-95"
        >
          <BellIcon />
        </button>
      </div>
    </header>
  );
}
