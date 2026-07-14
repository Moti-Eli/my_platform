"use client";

/**
 * The Home "app tabs" row — a YouTube-style horizontal chip strip that sits
 * directly under the header. Presentational: it receives resolved tabs (label
 * already translated, from the core registry via page.tsx) and shows them as
 * pill chips. A leading "הכל" (all) chip is selected by default; clicking any
 * chip just sets it as the selected one (visual state only — no filtering yet).
 * The trailing "+" pill links to the catalog. The row scrolls horizontally (RTL:
 * starts at the right, overflowing to the left) with the scrollbar hidden.
 */
import Link from "next/link";
import { useState } from "react";
import { PlusIcon } from "@/components/icons";
import { useI18n } from "@/i18n";

export interface ToolTab {
  id: string;
  label: string;
  route: string;
}

/**
 * TEMPORARY STUB DATA — presentational only, local to this row. Only the
 * inventory tool exists in the registry today; these placeholder chips exist
 * purely so the horizontal scroll is visible during the redesign. They are NOT
 * registered tools and carry no route/logic. Remove once real tools land.
 */
const STUB_CHIPS: { id: string; label: string }[] = [
  { id: "stub-calendar", label: "יומן" },
  { id: "stub-tasks", label: "משימות" },
  { id: "stub-contacts", label: "אנשי קשר" },
  { id: "stub-expenses", label: "הוצאות" },
  { id: "stub-docs", label: "מסמכים" },
  { id: "stub-projects", label: "פרויקטים" },
];

const ALL_ID = "all";

const CHIP_BASE =
  "shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition active:scale-95";

export function AppTabsRow({ tools }: { tools: ToolTab[] }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState(ALL_ID);

  // "הכל" (pinned first, source order) + real registry tools + stub chips.
  const chips = [
    { id: ALL_ID, label: t("home.allTab") },
    ...tools.map((tab) => ({ id: tab.id, label: tab.label })),
    ...STUB_CHIPS,
  ];

  return (
    <div
      role="tablist"
      aria-label={t("home.appTabsLabel")}
      className="no-scrollbar flex gap-2 overflow-x-auto pb-1"
    >
      {chips.map((chip) => {
        const isSelected = chip.id === selected;
        return (
          <button
            key={chip.id}
            type="button"
            role="tab"
            aria-selected={isSelected}
            onClick={() => setSelected(chip.id)}
            className={`${CHIP_BASE} ${
              isSelected ? "bg-ink text-screen" : "bg-hairline text-ink"
            }`}
          >
            {chip.label}
          </button>
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
