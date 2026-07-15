"use client";

/**
 * The bottom tab bar — 5 slots with the AI button as a dominant central hero.
 *
 * RTL order (right → left, matching the Standard):
 *   1. Home (right-most)   2. Catalog "כל הכלים"   3. AI hero (center)
 *   4. Comms "צ'אט"        5. Profile (left-most)
 *
 * The four corner slots are route links (active state via the current path);
 * the center AI hero is a button that TOGGLES the AI sheet (it is not a route) —
 * tapping it while the sheet is open closes it, like the profile tab.
 *
 * The bar sits at `z-50`, above every overlay (AI sheet, urgency inbox), so it is
 * always visible and tappable — the sheet opens above it, never over it.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";
import { HomeIcon, GridIcon, ChatIcon, UserIcon, SparkIcon } from "@/components/icons";
import { useI18n } from "@/i18n";

function TabLink({
  href,
  label,
  icon,
  active,
  onClick,
}: {
  href: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={`flex flex-1 flex-col items-center gap-2xs py-2xs touch-manipulation interactive motion-safe:active:scale-[0.97] ${
        active ? "text-accent" : "text-muted"
      }`}
    >
      <span>{icon}</span>
      <span className="type-caption">{label}</span>
    </Link>
  );
}

export function TabBar({
  aiOpen,
  onToggleAi,
  onHomeReselect,
}: {
  aiOpen: boolean;
  onToggleAi: () => void;
  onHomeReselect: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  // Re-tapping the home tab while already on home scrolls to the top instead of a
  // no-op re-navigation. Off home → the Link navigates to "/" as normal.
  const onHomeScreen = pathname === "/";
  const reselectHome = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    onHomeReselect();
  };

  // Toggle the profile tab: when already ON the profile screen, tapping it closes
  // it exactly like the top-bar back chevron (router.back()) instead of a no-op
  // re-navigation. Scoped to the exact route — on sub-pages the tap still routes
  // up to /profile as normal.
  const onProfileScreen = pathname === "/profile";
  const toggleProfile = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    router.back();
  };

  return (
    <nav
      aria-label={t("common.mainNav")}
      // `shrink-0`: never let the flex column compress the bar — it must keep its
      // full height at every scroll position. The bottom padding keeps clear of
      // the system nav bar (env safe-area) on top of the shell tracking the real
      // visible viewport height (see AppShell), which handles Chrome's URL bar.
      className="relative z-50 mt-auto flex shrink-0 items-end justify-between gap-2xs rounded-t-xl border-t border-hairline bg-card px-sm pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-xs"
    >
      <TabLink
        href="/"
        label={t("tabs.home")}
        icon={<HomeIcon />}
        active={isActive("/")}
        onClick={onHomeScreen ? reselectHome : undefined}
      />
      <TabLink
        href="/catalog"
        label={t("tabs.catalog")}
        icon={<GridIcon />}
        active={isActive("/catalog")}
      />

      {/* AI hero — larger, elevated above the bar. */}
      <div className="flex flex-1 justify-center">
        <button
          type="button"
          aria-label={t("tabs.ai")}
          aria-pressed={aiOpen}
          onClick={onToggleAi}
          className={`-mt-8 flex h-16 w-16 flex-col items-center justify-center rounded-full shadow-hero touch-manipulation interactive motion-safe:active:scale-[0.97] ${
            aiOpen ? "bg-inverse text-inverse-ink" : "bg-accent text-on-fill"
          }`}
        >
          <SparkIcon width={28} height={28} />
        </button>
      </div>

      <TabLink
        href="/comms"
        label={t("tabs.comms")}
        icon={<ChatIcon />}
        active={isActive("/comms")}
      />
      <TabLink
        href="/profile"
        label={t("tabs.profile")}
        icon={<UserIcon />}
        active={isActive("/profile")}
        onClick={onProfileScreen ? toggleProfile : undefined}
      />
    </nav>
  );
}
