"use client";

/**
 * Shifts full screen (Standard §2 `views/FullScreen.tsx`, §8) — picks the open
 * section from the URL (`nav.ts`) and renders it, with the floating section bar
 * under every section.
 *
 * Positions (part 1) and Employees (part 2) are built; Shifts shows a "coming
 * soon" card until part 3. The opening section is Shifts (agreed).
 */
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { useShiftsNav, shiftsHref } from "../nav";
import { PositionsScreen } from "./PositionsScreen";
import { EmployeesScreen } from "./EmployeesScreen";
import { ShiftsBar } from "./ShiftsBar";
import { EmptyCard, ToolHeader } from "./shared";

// userId/orgId arrive as props but are NOT sent to the action — the server
// derives identity from the session cookie.
export function FullScreen(_props: ToolViewProps) {
  const { t } = useI18n();
  const { section, go } = useShiftsNav();

  let screen;
  switch (section) {
    case "positions":
      screen = <PositionsScreen />;
      break;
    case "employees":
      screen = <EmployeesScreen />;
      break;
    case "shifts":
      screen = (
        <>
          <ToolHeader title={t("shifts.name")} />
          <EmptyCard titleKey="shifts.comingSoonTitle" hintKey="shifts.comingSoonShifts" />
        </>
      );
      break;
  }

  return (
    <>
      {/* Keyed by section so per-screen state (open forms, armed deletes)
          resets when switching. */}
      <div key={shiftsHref(section)} className="contents">
        {screen}
      </div>
      <ShiftsBar section={section} onChange={go} />
    </>
  );
}
