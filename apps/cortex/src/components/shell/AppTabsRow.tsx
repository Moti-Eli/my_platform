"use client";

/**
 * The app "tabs" row — a YouTube-style horizontal chip strip rendered by the
 * shell directly under the Header, so it appears on EVERY screen (including when
 * a sub-app is open). Presentational: it receives resolved tabs (label already
 * translated, from the core registry via AppShell) and shows them as pill chips.
 * Every chip navigates: "הכל" → Home (the glance grid), each registry tool → its
 * real page, each placeholder chip → its throwaway page under /tools/*. The
 * selected (dark) chip is derived from the current route. The trailing "+" pill
 * links to the catalog. The row scrolls horizontally (RTL: starts at the right,
 * overflowing to the left) with the scrollbar hidden.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PlusIcon } from "@/components/icons";
import { useI18n } from "@/i18n";
import { PLACEHOLDER_APPS } from "@/lib/placeholder-apps";

export interface ToolTab {
  id: string;
  label: string;
  route: string;
}

const CHIP_BASE =
  "shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition active:scale-95";

export function AppTabsRow({ tools }: { tools: ToolTab[] }) {
  const { t } = useI18n();
  const pathname = usePathname();

  // "הכל" (Home) + real registry tools + temporary placeholder apps. Each chip
  // carries the route it navigates to.
  const chips: { id: string; label: string; route: string }[] = [
    { id: "all", label: t("home.allTab"), route: "/" },
    ...tools.map((tab) => ({ id: tab.id, label: tab.label, route: tab.route })),
    ...PLACEHOLDER_APPS.map((app) => ({ id: app.id, label: t(app.labelKey), route: app.route })),
  ];

  const isActive = (route: string) => (route === "/" ? pathname === "/" : pathname === route);

  return (
    <div
      role="tablist"
      aria-label={t("home.appTabsLabel")}
      className="no-scrollbar flex gap-2 overflow-x-auto pb-2"
    >
      {chips.map((chip) => {
        const active = isActive(chip.route);
        return (
          <Link
            key={chip.id}
            href={chip.route}
            role="tab"
            aria-selected={active}
            className={`${CHIP_BASE} ${active ? "bg-ink text-screen" : "bg-hairline text-ink"}`}
          >
            {chip.label}
          </Link>
        );
      })}

      {/* Trailing "+" pill — same chip design; opens the full tool catalog. */}
      <Link
        href="/catalog"
        aria-label={t("catalog.title")}
        className={`${CHIP_BASE} flex items-center justify-center bg-hairline text-ink`}
      >
        <PlusIcon width={18} height={18} />
      </Link>
    </div>
  );
}
