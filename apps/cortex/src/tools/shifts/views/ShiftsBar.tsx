"use client";

/**
 * Floating section switcher — the tasks filter bar's chrome (`sticky bottom-sm`
 * + `mt-auto`, translucent card, backdrop blur; see tasks' FilterBar header for
 * why sticky, not fixed): the hamburger at the edge, a hairline divider, then
 * the tool's three sections as segments: Shifts / Employees / Positions.
 *
 * The hamburger opens a small menu above the bar — the same pattern as the
 * orders bar (things done occasionally, not daily). Today: "Manage org members",
 * which opens the staff tool. Employees are added to shifts only FROM the org's
 * members, so a brand-new person is added to the org there first. A plain link
 * to staff's route — the staff tool itself is not touched.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n, type MessageKey } from "@/i18n";
import { MenuIcon } from "@/components/icons";
import type { ShiftsSection } from "../nav";

/** The staff tool's route (matches `TOOL_VIEWS.staff.route`). */
const STAFF_ROUTE = "/tools/staff";

const SECTIONS: Array<{ key: ShiftsSection; labelKey: MessageKey }> = [
  { key: "shifts", labelKey: "shifts.tabShifts" },
  { key: "employees", labelKey: "shifts.tabEmployees" },
  { key: "positions", labelKey: "shifts.tabPositions" },
];

export function ShiftsBar({
  section,
  onChange,
}: {
  section: ShiftsSection;
  onChange: (next: ShiftsSection) => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav
      aria-label={t("shifts.sectionsLabel")}
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
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  router.push(STAFF_ROUTE);
                }}
                className="rounded-md px-sm py-xs text-start type-label text-ink interactive"
              >
                {t("shifts.manageMembers")}
              </button>
            </div>
          </>
        ) : null}
        <button
          type="button"
          aria-label={t("shifts.menu")}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full interactive motion-safe:active:scale-[0.97] ${
            menuOpen ? "bg-app-coral/15 text-app-coral" : "text-muted"
          }`}
        >
          <MenuIcon width={18} height={18} />
        </button>
      </div>
      <span className="h-5 w-px shrink-0 bg-hairline" aria-hidden="true" />
      {SECTIONS.map((s) => {
        const active = section === s.key;
        return (
          <button
            key={s.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(s.key)}
            className={`rounded-pill px-sm py-2xs type-label interactive motion-safe:active:scale-[0.97] ${
              active ? "bg-app-coral text-on-fill" : "text-muted"
            }`}
          >
            {t(s.labelKey)}
          </button>
        );
      })}
    </nav>
  );
}
