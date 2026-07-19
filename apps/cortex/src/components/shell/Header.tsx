"use client";

/**
 * The shell header — a three-zone sticky top row (RTL):
 *  - leading edge (right): a search button that opens a floating search bar;
 *  - center: the "cortex" {@link Wordmark} (its own component, so the bare auth
 *    screens render the same element rather than a copy that drifts);
 *  - trailing edge (left): a bell that opens the urgency inbox.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { SearchIcon, BellIcon, ChevronIcon } from "@/components/icons";
import { useI18n, type MessageKey } from "@/i18n";
import { useInstalledApps } from "@/lib/installed-apps";
import { useRegisteredApps } from "@/cortex/apps";
import { appIcon, appColorClasses } from "@/components/app-visuals";
import { STAFF_MEMBERS_KEY } from "@/lib/query/useStaffMembers";
import { useGlobalSearch, type SearchGroup } from "@/lib/search/useGlobalSearch";
import { Wordmark } from "./Wordmark";

export function Header({ onOpenInbox }: { onOpenInbox: () => void }) {
  const { t } = useI18n();
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <>
      <header className="flex items-center gap-sm px-md py-xs">
        <button
          type="button"
          aria-label={t("common.search")}
          onClick={() => setSearchOpen(true)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink touch-manipulation interactive motion-safe:active:scale-[0.97]"
        >
          <SearchIcon />
        </button>

        <Wordmark className="flex-1 text-center" />

        <button
          type="button"
          aria-label={t("urgency.title")}
          onClick={onOpenInbox}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink touch-manipulation interactive motion-safe:active:scale-[0.97]"
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
 * dimmed scrim. The input autofocuses and drives a LIVE cross-tool search over the
 * react-query caches of the installed tools (see {@link useGlobalSearch}): it reads
 * only what's already loaded, never fetches. A start-edge chevron (RTL "back",
 * points right), a scrim tap, or Escape closes it; closing unmounts the overlay,
 * which discards the input value. Choosing a result navigates to that tool and
 * closes the overlay — the only side effect this presentational overlay has.
 */
function SearchOverlay({ onClose }: { onClose: () => void }) {
  const { t, dir } = useI18n();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const installedIds = useInstalledApps();
  // Admin signal, derived client-side: the staff query runs only behind the
  // admin-gated /tools/staff route, so a cache entry existing at all means the user
  // is an admin (a non-admin is redirected before it can ever run). Belt-and-braces
  // with the installed + non-empty-cache checks inside the hook.
  const isAdmin = queryClient.getQueryData(STAFF_MEMBERS_KEY) !== undefined;

  const groups = useGlobalSearch(value, { installedIds, isAdmin });
  const hasQuery = value.trim() !== "";

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
        className="ds-backdrop absolute inset-0 bg-scrim touch-manipulation"
      />

      {/* Column: the input card stays put; the results card below it scrolls, and
          the whole panel is capped to the visible viewport so it never overflows. */}
      <div className="ds-panel relative z-10 mt-sm flex max-h-[calc(var(--app-vh,100dvh)-16px)] w-full max-w-[480px] flex-col gap-sm px-sm">
        <div className="flex shrink-0 items-center gap-xs rounded-lg bg-card px-sm py-2xs shadow-lifted">
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.back")}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink touch-manipulation interactive motion-safe:active:scale-[0.97]"
          >
            <ChevronIcon style={{ transform: dir === "rtl" ? "scaleX(-1)" : undefined }} />
          </button>
          <input
            ref={inputRef}
            type="search"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t("common.searchPlaceholder")}
            className="min-w-0 flex-1 bg-transparent px-2xs py-xs type-body text-ink outline-none placeholder:text-muted"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-card px-sm py-sm shadow-lifted">
          {!hasQuery ? (
            <p className="px-2xs py-xs type-label text-muted">{t("search.hint")}</p>
          ) : groups.length === 0 ? (
            <p className="px-2xs py-xs type-label text-muted">{t("search.noResults")}</p>
          ) : (
            <div className="flex flex-col gap-sm">
              {groups.map((group) => (
                <SearchResultGroup key={group.tool} group={group} onNavigate={onClose} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One tool's results block: a small tool header (its icon + name) then the matched
 * rows, each a link to the tool that closes the overlay on tap. A "+N more" line
 * appears when matches exceeded the per-group cap.
 */
function SearchResultGroup({
  group,
  onNavigate,
}: {
  group: SearchGroup;
  onNavigate: () => void;
}) {
  const { t } = useI18n();
  // Resolve the tool's manifest for its icon/colour (same source Home uses). The
  // registry may still be loading on first paint — fall back to no icon then.
  const apps = useRegisteredApps();
  const manifest = apps.find((m) => m.id === group.tool);
  const Icon = manifest ? appIcon(manifest.icon) : null;

  return (
    <section>
      <div className="flex items-center gap-xs px-2xs pb-2xs">
        {Icon ? (
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full ${appColorClasses(
              manifest!.color,
            )}`}
          >
            <Icon width={14} height={14} />
          </span>
        ) : null}
        <span className="type-label text-muted">{t(group.labelKey as MessageKey)}</span>
      </div>

      <ul className="flex flex-col">
        {group.items.map((hit) => (
          <li key={hit.id}>
            <Link
              href={hit.route}
              onClick={onNavigate}
              className="flex flex-col gap-2xs rounded-md px-2xs py-xs touch-manipulation interactive"
            >
              <span className="truncate type-body text-ink">{hit.primary}</span>
              {hit.secondary ? (
                <span className="truncate type-label text-muted">{hit.secondary}</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>

      {group.more > 0 ? (
        <p className="px-2xs pt-2xs type-caption text-muted">
          {t("search.more").replace("{count}", String(group.more))}
        </p>
      ) : null}
    </section>
  );
}
