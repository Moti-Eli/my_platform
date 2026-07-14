"use client";

/**
 * The shell header — a three-zone sticky top row (RTL):
 *  - leading edge (right): a search button that opens a floating search bar;
 *  - center: the "cortex" wordmark, a styled-text placeholder for a future SVG
 *    logo (kept LTR — latin letters — even inside the RTL layout);
 *  - trailing edge (left): a bell that opens the urgency inbox.
 *
 * There is no brand/display font token in the design-system, so the wordmark
 * uses a cursive fallback stack (the one non-token value here, by design).
 */
import { useEffect, useRef, useState } from "react";
import { SearchIcon, BellIcon, ChevronIcon } from "@/components/icons";
import { useI18n } from "@/i18n";

export function Header({ onOpenInbox }: { onOpenInbox: () => void }) {
  const { t } = useI18n();
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <>
      <header className="flex items-center gap-3 px-5 py-4">
        <button
          type="button"
          aria-label={t("common.search")}
          onClick={() => setSearchOpen(true)}
          className="flex h-10 w-10 shrink-0 items-center justify-center text-ink transition active:scale-95"
        >
          <SearchIcon />
        </button>

        <span
          dir="ltr"
          className="flex-1 text-center text-3xl leading-none text-indigo"
          style={{ fontFamily: '"Segoe Script", "Bradley Hand", "Brush Script MT", cursive' }}
        >
          cortex
        </span>

        <button
          type="button"
          aria-label={t("urgency.title")}
          onClick={onOpenInbox}
          className="flex h-10 w-10 shrink-0 items-center justify-center text-ink transition active:scale-95"
        >
          <BellIcon />
        </button>
      </header>

      {searchOpen ? <SearchOverlay onClose={() => setSearchOpen(false)} /> : null}
    </>
  );
}

/**
 * The floating search bar — an elevated card that overlays the top row, over a
 * dimmed scrim. The input autofocuses but is non-functional (no query logic
 * yet). A start-edge chevron (RTL "back", points right) or a scrim tap closes
 * it; closing unmounts the overlay, which discards the input value.
 */
function SearchOverlay({ onClose }: { onClose: () => void }) {
  const { t, dir } = useI18n();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={t("common.search")}
    >
      <button
        type="button"
        aria-label={t("common.close")}
        onClick={onClose}
        className="ds-backdrop absolute inset-0 bg-ink/30"
      />

      <div className="ds-panel relative z-10 mt-3 w-full max-w-[480px] px-3">
        <div className="flex items-center gap-2 rounded-xl bg-card px-3 py-2 shadow-lifted">
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.back")}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink transition active:scale-95"
          >
            <ChevronIcon style={{ transform: dir === "rtl" ? "scaleX(-1)" : undefined }} />
          </button>
          <input
            ref={inputRef}
            type="search"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t("common.searchPlaceholder")}
            className="min-w-0 flex-1 bg-transparent px-1 py-2 text-base text-ink outline-none placeholder:text-muted"
          />
        </div>
      </div>
    </div>
  );
}
