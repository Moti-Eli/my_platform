"use client";

/**
 * Shifts full screen (Standard §2 `views/FullScreen.tsx`, §8) — picks what to
 * show from WHO the user is (two flags from the page) and WHERE they are (the
 * URL, `nav.ts`):
 *
 *   manager (org admin)      → the stage-1 sections (Shifts / Employees /
 *                              Positions) + the week's Availability table
 *                              (stage 2), with the floating section bar; a
 *                              manager who is ALSO in the tool gets "My
 *                              submission" too (their own week, counted in
 *                              the table like everyone else).
 *   employee in the tool     → their own bar (EmployeeBar): "My submission"
 *                              (EmployeeWeekScreen, the default) and "Shifts"
 *                              (the regular shifts, read-only).
 *   neither                  → "you're not in the shifts tool".
 *
 * `isAdmin` / `isEmployee` only decide what to OFFER (like time_entries'
 * isAdmin): RLS still gates every row — reads are open to the org, writes need
 * `shifts.manage`.
 */
import type { ToolViewProps } from "@/tools";
import { useShiftsNav, shiftsHref } from "../nav";
import { PositionsScreen } from "./PositionsScreen";
import { EmployeesScreen } from "./EmployeesScreen";
import { ShiftsScreen } from "./ShiftsScreen";
import { ShiftEditScreen } from "./ShiftEditScreen";
import { EmployeeBar, ShiftsBar } from "./ShiftsBar";
import { EmployeeWeekScreen } from "./EmployeeWeekScreen";
import { EmployeeShiftsScreen } from "./EmployeeShiftsScreen";
import { QuestionsScreen } from "./QuestionsScreen";
import { NotInToolScreen } from "./NotInToolScreen";
import { AvailabilityScreen } from "./AvailabilityScreen";

// userId/orgId arrive as props but are NOT sent to the action — the server
// derives identity from the session cookie. The two flags are widened LOCALLY
// (the shared ToolViewProps type stays untouched), exactly as time_entries does.
export function FullScreen({
  isAdmin,
  isEmployee,
}: ToolViewProps & { isAdmin: boolean; isEmployee: boolean }) {
  const {
    section,
    employeeSection,
    day,
    shiftId,
    add,
    week,
    go,
    goEmployee,
    setDay,
    setWeek,
    openShift,
    clearAdd,
  } = useShiftsNav();

  if (!isAdmin) {
    if (!isEmployee) return <NotInToolScreen />;
    return (
      <>
        <div key={employeeSection} className="contents">
          {employeeSection === "week" ? (
            <EmployeeShiftsScreen />
          ) : (
            <EmployeeWeekScreen week={week} onWeekChange={setWeek} />
          )}
        </div>
        <EmployeeBar section={employeeSection} onChange={goEmployee} />
      </>
    );
  }

  // `?view=mine` from a manager who is not in the tool falls back to Shifts.
  const current = section === "mine" && !isEmployee ? "shifts" : section;

  let screen;
  switch (current) {
    case "mine":
      screen = <EmployeeWeekScreen week={week} onWeekChange={setWeek} />;
      break;
    case "questions":
      screen = <QuestionsScreen />;
      break;
    case "positions":
      screen = <PositionsScreen />;
      break;
    case "employees":
      screen = <EmployeesScreen />;
      break;
    case "availability":
      screen = <AvailabilityScreen week={week} onWeekChange={setWeek} />;
      break;
    case "shifts":
      screen = shiftId ? (
        <ShiftEditScreen shiftId={shiftId} onGoToPositions={() => go("positions")} />
      ) : (
        <ShiftsScreen
          day={day}
          onDayChange={setDay}
          onOpenShift={openShift}
          openAdd={add}
          onAddOpened={clearAdd}
        />
      );
      break;
  }

  return (
    <>
      {/* Keyed by section (+ open shift) so per-screen state (open forms,
          armed deletes) resets when switching — but NOT by day, so picking a
          day keeps the day view mounted. */}
      <div key={`${shiftsHref(current)}|${shiftId ?? ""}`} className="contents">
        {screen}
      </div>
      <ShiftsBar section={current} onChange={go} showMine={isEmployee} />
    </>
  );
}
