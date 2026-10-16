"use client";

/**
 * Shifts full screen (Standard §2 `views/FullScreen.tsx`, §8) — picks the open
 * section from the URL (`nav.ts`) and renders it, with the floating section bar
 * under every section.
 *
 * Sections: Shifts (part 3 — the opening section, agreed; a shift's edit screen
 * opens from it), Employees (part 2), Positions (part 1).
 */
import type { ToolViewProps } from "@/tools";
import { useShiftsNav, shiftsHref } from "../nav";
import { PositionsScreen } from "./PositionsScreen";
import { EmployeesScreen } from "./EmployeesScreen";
import { ShiftsScreen } from "./ShiftsScreen";
import { ShiftEditScreen } from "./ShiftEditScreen";
import { ShiftsBar } from "./ShiftsBar";

// userId/orgId arrive as props but are NOT sent to the action — the server
// derives identity from the session cookie.
export function FullScreen(_props: ToolViewProps) {
  const { section, day, shiftId, go, setDay, openShift } = useShiftsNav();

  let screen;
  switch (section) {
    case "positions":
      screen = <PositionsScreen />;
      break;
    case "employees":
      screen = <EmployeesScreen />;
      break;
    case "shifts":
      screen = shiftId ? (
        <ShiftEditScreen shiftId={shiftId} onGoToPositions={() => go("positions")} />
      ) : (
        <ShiftsScreen day={day} onDayChange={setDay} onOpenShift={openShift} />
      );
      break;
  }

  return (
    <>
      {/* Keyed by section (+ open shift) so per-screen state (open forms,
          armed deletes) resets when switching — but NOT by day, so picking a
          day keeps the day view mounted. */}
      <div key={`${shiftsHref(section)}|${shiftId ?? ""}`} className="contents">
        {screen}
      </div>
      <ShiftsBar section={section} onChange={go} />
    </>
  );
}
