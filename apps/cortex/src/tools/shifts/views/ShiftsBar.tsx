"use client";

/**
 * Floating section switchers — the tasks filter bar's chrome (`sticky bottom-sm`
 * + `mt-auto`, translucent card, backdrop blur; see tasks' FilterBar header for
 * why sticky, not fixed): the hamburger at the edge, a hairline divider, then
 * the sections as segments. ONE bar (`SectionBar`), two configurations:
 *
 *   ShiftsBar    (manager)  Shifts / Employees / Positions / Availability, plus
 *                           "Mine" for a manager who is also in the tool.
 *                           Menu: "Submission questions" (?view=questions)
 *                           and "Manage org members" → the staff tool
 *                           (employees are added to shifts only FROM the org's
 *                           members; a plain link, staff itself is not touched).
 *   EmployeeBar  (employee) My submission / Shifts (read-only). Future sections
 *                           (my schedule, hours, pay, history) are one entry
 *                           each in EMPLOYEE_SECTIONS + a case in FullScreen.
 *                           Menu: empty for now (staff is admin-only).
 *
 * The hamburger opens a small menu above the bar — the orders bar's pattern
 * (things done occasionally, not daily).
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n, type MessageKey } from "@/i18n";
import { MenuIcon } from "@/components/icons";
import type { EmployeeSection, ShiftsSection } from "../nav";

/** The staff tool's route (matches `TOOL_VIEWS.staff.route`). */
const STAFF_ROUTE = "/tools/staff";

interface BarSection<K extends string> {
  key: K;
  labelKey: MessageKey;
  /** What a screen reader hears when the visible label is shortened. */
  ariaKey?: MessageKey;
}

interface MenuItem {
  labelKey: MessageKey;
  onSelect: () => void;
}

const MANAGER_SECTIONS: BarSection<ShiftsSection>[] = [
  { key: "shifts", labelKey: "shifts.tabShifts" },
  { key: "employees", labelKey: "shifts.tabEmployees" },
  { key: "positions", labelKey: "shifts.tabPositions" },
  { key: "availability", labelKey: "shifts.tabAvailability" },
  // Short on screen ("Mine") so five segments fit a 360px phone; the full name
  // is what a screen reader hears.
  { key: "mine", labelKey: "shifts.tabMine", ariaKey: "shifts.mySubmission" },
];

/** The employee's sections, in bar order. Add future ones here. */
const EMPLOYEE_SECTIONS: BarSection<EmployeeSection>[] = [
  { key: "mine", labelKey: "shifts.mySubmission" },
  { key: "week", labelKey: "shifts.tabShifts" },
];

export function ShiftsBar({
  section,
  onChange,
  showMine,
}: {
  section: ShiftsSection;
  onChange: (next: ShiftsSection) => void;
  /** The manager is also an employee in the tool → offer their own week. */
  showMine: boolean;
}) {
  const router = useRouter();
  return (
    <SectionBar
      sections={MANAGER_SECTIONS.filter((s) => s.key !== "mine" || showMine)}
      active={section}
      onChange={onChange}
      menu={[
        { labelKey: "shifts.menuQuestions", onSelect: () => onChange("questions") },
        { labelKey: "shifts.manageMembers", onSelect: () => router.push(STAFF_ROUTE) },
      ]}
    />
  );
}

export function EmployeeBar({
  section,
  onChange,
}: {
  section: EmployeeSection;
  onChange: (next: EmployeeSection) => void;
}) {
  return <SectionBar sections={EMPLOYEE_SECTIONS} active={section} onChange={onChange} menu={[]} />;
}

function SectionBar<K extends string>({
  sections,
  active,
  onChange,
  menu,
}: {
  sections: BarSection<K>[];
  active: K;
  onChange: (next: K) => void;
  /** Empty → the menu says there is nothing here yet. */
  menu: MenuItem[];
}) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // Five segments only fit a phone with the tighter padding; labels never wrap.
  const pad = sections.length > 4 ? "px-xs" : "px-sm";

  // Tap anywhere else (or Escape) closes the menu. A listener, not a full-screen
  // `fixed` scrim: the bar's backdrop-blur makes it the containing block for
  // fixed children, so such a scrim covered only the bar itself.
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <nav
      aria-label={t("shifts.sectionsLabel")}
      className="sticky bottom-sm z-40 mt-auto flex w-fit shrink-0 items-center gap-2xs self-center rounded-pill border border-hairline bg-card/70 p-2xs shadow-lifted backdrop-blur-md"
    >
      <div ref={menuRef} className="relative">
        {menuOpen ? (
          <>
            <div
              role="menu"
              className="absolute bottom-full start-0 z-50 mb-xs flex min-w-max flex-col rounded-lg border border-hairline bg-card p-2xs shadow-lifted"
            >
              {menu.length === 0 ? (
                <p className="px-sm py-xs type-caption text-muted">{t("shifts.menuEmpty")}</p>
              ) : (
                menu.map((item) => (
                  <button
                    key={item.labelKey}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      item.onSelect();
                    }}
                    className="rounded-md px-sm py-xs text-start type-label text-ink interactive"
                  >
                    {t(item.labelKey)}
                  </button>
                ))
              )}
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
      {sections.map((s) => {
        const isActive = active === s.key;
        return (
          <button
            key={s.key}
            type="button"
            aria-pressed={isActive}
            aria-label={s.ariaKey ? t(s.ariaKey) : undefined}
            onClick={() => onChange(s.key)}
            className={`whitespace-nowrap rounded-pill py-2xs type-label interactive motion-safe:active:scale-[0.97] ${pad} ${
              isActive ? "bg-app-coral text-on-fill" : "text-muted"
            }`}
          >
            {t(s.labelKey)}
          </button>
        );
      })}
    </nav>
  );
}
