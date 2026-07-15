"use client";

/**
 * The bottom tab bar — 5 slots with the AI button as a dominant central hero.
 *
 * RTL order (right → left, matching the Standard):
 *   1. Home (right-most)   2. Catalog "כל הכלים"   3. AI hero (center)
 *   4. Comms "צ'אט"        5. Profile (left-most)
 *
 * The four corner slots are route links (active state via the current path);
 * the center AI hero is a button that opens the AI sheet (it is not a route).
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
      className={`flex flex-1 flex-col items-center gap-1 py-1 touch-manipulation transition active:transition-none active:opacity-80 ${
        active ? "text-indigo" : "text-muted"
      }`}
    >
      <span className="transition active:transition-none motion-safe:active:scale-90">{icon}</span>
      <span className="text-[11px] font-medium">{label}</span>
    </Link>
  );
}

export function TabBar({ onOpenAi }: { onOpenAi: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

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
      className="relative z-20 mt-auto flex shrink-0 items-end justify-between gap-1 rounded-t-xl bg-card px-3 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 shadow-lifted"
    >
      <TabLink href="/" label={t("tabs.home")} icon={<HomeIcon />} active={isActive("/")} />
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
          onClick={onOpenAi}
          className="-mt-8 flex h-16 w-16 flex-col items-center justify-center rounded-full bg-indigo text-white shadow-hero touch-manipulation transition active:transition-none active:opacity-90 motion-safe:active:scale-95"
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
