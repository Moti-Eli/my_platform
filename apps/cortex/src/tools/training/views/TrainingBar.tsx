"use client";

/**
 * Floating bar — the SAME chrome and controls as the orders bar (and the
 * shifts/tasks bars): `sticky bottom-sm` + `mt-auto`, translucent card,
 * backdrop blur (see tasks' FilterBar header for why sticky, not fixed).
 *
 *   ☰  hamburger — opens a small menu above the bar: New plan, My plans, and —
 *                  while a plan is open — Rename and Delete plan (Delete only
 *                  for the plan's owner).
 *   🔍 search    — collapsed to an icon; tapping expands an input that filters
 *                  the CURRENT screen's list (plans / days / exercises). ✕
 *                  clears it and collapses back.
 */
import { useEffect, useRef, useState } from "react";
import { useI18n, type MessageKey } from "@/i18n";
import { CloseIcon, MenuIcon, SearchIcon } from "@/components/icons";

export interface BarMenuItem {
  labelKey: MessageKey;
  onSelect: () => void;
  danger?: boolean;
}

export function TrainingBar({
  search,
  onSearchChange,
  menu,
}: {
  search: string;
  onSearchChange: (next: string) => void;
  menu: BarMenuItem[];
}) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  // Open if there is search text, or by tap.
  const [searchOpen, setSearchOpen] = useState(search !== "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  // The screen changed and cleared the search — collapse with it.
  useEffect(() => {
    if (search === "" && document.activeElement !== inputRef.current) setSearchOpen(false);
  }, [search]);

  return (
    <nav
      aria-label={t("training.barLabel")}
      className="sticky bottom-sm z-40 mt-auto flex w-fit shrink-0 items-center gap-2xs self-center rounded-pill border border-hairline bg-card/70 p-2xs shadow-lifted backdrop-blur-md"
    >
      <div className="relative">
        {menuOpen ? (
          <>
            {/* Tap-anywhere-else closes the menu. Below the menu, above the page. */}
            <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setMenuOpen(false)} />
            <div
              role="menu"
              className="absolute bottom-full start-0 z-50 mb-xs flex min-w-max flex-col rounded-lg border border-hairline bg-card p-2xs shadow-lifted"
            >
              {menu.map((item) => (
                <button
                  key={item.labelKey}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    item.onSelect();
                  }}
                  className={`rounded-md px-sm py-xs text-start type-label interactive ${
                    item.danger ? "text-danger" : "text-ink"
                  }`}
                >
                  {t(item.labelKey)}
                </button>
              ))}
            </div>
          </>
        ) : null}
        <button
          type="button"
          aria-label={t("training.menu")}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full interactive motion-safe:active:scale-[0.97] ${
            menuOpen ? "bg-app-amber/15 text-app-amber" : "text-muted"
          }`}
        >
          <MenuIcon width={18} height={18} />
        </button>
      </div>
      <span className="h-5 w-px shrink-0 bg-hairline" aria-hidden="true" />
      {searchOpen ? (
        <label className="flex items-center gap-2xs ps-xs text-muted">
          <SearchIcon width={16} height={16} aria-hidden />
          <input
            ref={inputRef}
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("training.searchPlaceholder")}
            aria-label={t("training.search")}
            className="w-36 bg-transparent py-2xs type-label text-ink outline-none placeholder:text-muted"
          />
          <button
            type="button"
            aria-label={t("training.closeSearch")}
            onClick={() => {
              onSearchChange("");
              setSearchOpen(false);
            }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted interactive"
          >
            <CloseIcon width={14} height={14} />
          </button>
        </label>
      ) : (
        <button
          type="button"
          aria-label={t("training.search")}
          onClick={() => setSearchOpen(true)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted interactive motion-safe:active:scale-[0.97]"
        >
          <SearchIcon width={18} height={18} />
        </button>
      )}
    </nav>
  );
}
