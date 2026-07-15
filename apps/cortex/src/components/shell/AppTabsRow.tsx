"use client";

/**
 * The app "tabs" row — a YouTube-style horizontal chip strip rendered by the
 * shell directly under the Header, so it appears on EVERY screen. It shows only
 * the INSTALLED apps (passed in, already resolved from the registry): "הכל" →
 * Home, one chip per installed app → its page, and a trailing "+" → the catalog.
 * The selected (dark) chip is derived from the current route. Long-pressing (or
 * right-clicking / pressing Delete on) an installed chip opens a small menu,
 * anchored to that chip, to uninstall it. The row scrolls horizontally (RTL)
 * with the scrollbar hidden.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PlusIcon } from "@/components/icons";
import { useI18n } from "@/i18n";
import { uninstall } from "@/lib/installed-apps";

export interface ToolTab {
  id: string;
  label: string;
  route: string;
}

// `touch-manipulation` drops the ~300ms mobile tap delay; `min-h-11` (44px) +
// inline-flex centering gives an accessible tap target while staying compact.
const CHIP_BASE =
  "inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-md px-4 text-sm font-semibold touch-manipulation transition active:transition-none active:opacity-80 motion-safe:active:scale-95";

const LONG_PRESS_MS = 500;
/** Gap between a chip and its popover, and a rough popover height for the
 * below/above flip decision. */
const MENU_GAP = 6;
const MENU_EST_HEIGHT = 44;

/** Where the open menu is anchored — the target chip's viewport geometry. */
interface MenuAnchor {
  id: string;
  label: string;
  centerX: number;
  top: number;
  bottom: number;
}

export function AppTabsRow({ tools }: { tools: ToolTab[] }) {
  const { t } = useI18n();
  const pathname = usePathname();

  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set when a long-press fired so the ensuing click doesn't also navigate.
  const suppressClick = useRef(false);

  const isActive = (route: string) => (route === "/" ? pathname === "/" : pathname === route);

  // Anchor the menu to the chip element itself (centered on it), so it's obvious
  // which chip is being removed regardless of where the pointer/cursor was.
  const openMenu = (tab: ToolTab, chip: HTMLElement) => {
    const r = chip.getBoundingClientRect();
    suppressClick.current = true;
    setMenu({ id: tab.id, label: tab.label, centerX: r.left + r.width / 2, top: r.top, bottom: r.bottom });
  };

  const clearTimer = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  // Close the popover on Escape.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menu]);

  // Flip above the chip if there isn't room below it in the viewport.
  const placeAbove =
    menu !== null &&
    typeof window !== "undefined" &&
    menu.bottom + MENU_GAP + MENU_EST_HEIGHT > window.innerHeight;

  return (
    <div
      role="tablist"
      aria-label={t("home.appTabsLabel")}
      className="no-scrollbar flex gap-2 overflow-x-auto pb-1.5"
    >
      {/* "הכל" — Home / the glance view. Not removable. */}
      <Link
        href="/"
        role="tab"
        aria-selected={isActive("/")}
        className={`${CHIP_BASE} ${isActive("/") ? "bg-ink text-screen" : "bg-hairline text-ink"}`}
      >
        {t("home.allTab")}
      </Link>

      {/* Installed apps — long-press / right-click / Delete to uninstall. */}
      {tools.map((tab) => {
        const active = isActive(tab.route);
        const menuOpen = menu?.id === tab.id;
        return (
          <Link
            key={tab.id}
            href={tab.route}
            role="tab"
            aria-selected={active}
            className={`${CHIP_BASE} ${active ? "bg-ink text-screen" : "bg-hairline text-ink"} ${
              menuOpen ? "ring-2 ring-coral" : ""
            }`}
            onClick={(e) => {
              if (suppressClick.current) {
                e.preventDefault();
                suppressClick.current = false;
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              openMenu(tab, e.currentTarget);
            }}
            onKeyDown={(e) => {
              if (e.key === "Delete" || e.key === "Backspace" || e.key === "ContextMenu") {
                e.preventDefault();
                openMenu(tab, e.currentTarget);
              }
            }}
            onPointerDown={(e) => {
              // A fresh press must never be gated by a stale suppress flag left
              // by an earlier long-press whose popover was dismissed without
              // tapping the chip — otherwise this tap gets swallowed.
              suppressClick.current = false;
              if (e.pointerType !== "touch") return;
              clearTimer();
              const chip = e.currentTarget;
              pressTimer.current = setTimeout(() => openMenu(tab, chip), LONG_PRESS_MS);
            }}
            onPointerUp={clearTimer}
            onPointerCancel={clearTimer}
            onPointerLeave={clearTimer}
            onPointerMove={clearTimer}
          >
            {tab.label}
          </Link>
        );
      })}

      {/* Trailing "+" pill — same chip design AND same route-active treatment. */}
      <Link
        href="/catalog"
        role="tab"
        aria-selected={isActive("/catalog")}
        aria-label={t("catalog.title")}
        className={`${CHIP_BASE} ${
          isActive("/catalog") ? "bg-ink text-screen" : "bg-hairline text-ink"
        }`}
      >
        <PlusIcon width={18} height={18} />
      </Link>

      {menu ? (
        <>
          {/* Outside-press catcher — closes the menu. */}
          <button
            type="button"
            aria-label={t("common.close")}
            className="fixed inset-0 z-40 cursor-default touch-manipulation"
            onClick={() => setMenu(null)}
          />
          {/* Small popover anchored to (and centered on) the target chip. Fixed
              position so the row's horizontal overflow never clips it and the
              row layout never shifts.

              The centering `translateX(-50%)` lives on this OUTER wrapper, which
              is NOT animated — while the `ds-panel` entrance animation (which
              animates `transform`) lives on the INNER element. If both were on
              one element, the keyframes would override the inline centering for
              the animation's duration, so it would paint off-center and then snap
              into place. Split, they compose: centered from the very first frame,
              with only the vertical drop-in animating. */}
          <div
            className="fixed z-50"
            style={{
              left: menu.centerX,
              top: placeAbove ? menu.top - MENU_GAP : menu.bottom + MENU_GAP,
              transform: placeAbove ? "translate(-50%, -100%)" : "translateX(-50%)",
            }}
          >
            <div
              role="menu"
              aria-label={menu.label}
              className="ds-panel rounded-lg bg-card p-1 shadow-lifted"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  uninstall(menu.id);
                  setMenu(null);
                }}
                className="whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium text-coral touch-manipulation transition active:transition-none active:bg-hairline motion-safe:active:scale-95"
              >
                {t("apps.remove")}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
