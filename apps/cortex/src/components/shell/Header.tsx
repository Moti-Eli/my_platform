"use client";

/**
 * The shell header: logo + wordmark, a (stub) search button, and the urgency
 * bell on the left (leading edge in RTL). The bell opens the urgency inbox.
 */
import { BrainLogo } from "@/components/BrainLogo";
import { SearchIcon, BellIcon } from "@/components/icons";

export function Header({ onOpenInbox }: { onOpenInbox: () => void }) {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-3 bg-screen/90 px-5 py-4 backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-card text-indigo shadow-soft">
          <BrainLogo />
        </span>
        <span className="text-lg font-bold tracking-tight text-ink">Cortex</span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="חיפוש"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-ink shadow-soft transition active:scale-95"
        >
          <SearchIcon />
        </button>
        <button
          type="button"
          aria-label="מה דחוף היום"
          onClick={onOpenInbox}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-coral shadow-soft transition active:scale-95"
        >
          <BellIcon />
        </button>
      </div>
    </header>
  );
}
