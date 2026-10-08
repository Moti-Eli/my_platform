"use client";

/**
 * react-query hooks for the shifts tool's people: the org's active members, the
 * employees in the tool, and which positions each can fill. Same shape as
 * `useShiftPositions` (server action per read; `!ok` becomes a thrown Error so
 * `isError` is real). Every shifts view shares these cache entries and
 * reconciles them via `setQueryData` after its own writes.
 */
import { useQuery } from "@tanstack/react-query";
import { runIntentAction } from "@/cortex/actions";
import type { Employee, EmployeePosition, OrgMember } from "@/tools/shifts/logic";

export const SHIFT_MEMBERS_KEY = ["shifts", "members"] as const;
export const SHIFT_EMPLOYEES_KEY = ["shifts", "employees"] as const;
export const SHIFT_EMPLOYEE_POSITIONS_KEY = ["shifts", "employeePositions"] as const;

export function useOrgMembers() {
  const query = useQuery({
    queryKey: SHIFT_MEMBERS_KEY,
    queryFn: async (): Promise<OrgMember[]> => {
      const res = await runIntentAction("shifts.list_org_members", {});
      if (!res.ok) throw new Error(res.code);
      return res.data as OrgMember[];
    },
  });
  const members: OrgMember[] = query.data ?? [];
  return { ...query, members };
}

export function useShiftEmployees() {
  const query = useQuery({
    queryKey: SHIFT_EMPLOYEES_KEY,
    queryFn: async (): Promise<Employee[]> => {
      const res = await runIntentAction("shifts.list_employees", {});
      if (!res.ok) throw new Error(res.code);
      return res.data as Employee[];
    },
  });
  const employees: Employee[] = query.data ?? [];
  return { ...query, employees };
}

export function useShiftEmployeePositions() {
  const query = useQuery({
    queryKey: SHIFT_EMPLOYEE_POSITIONS_KEY,
    queryFn: async (): Promise<EmployeePosition[]> => {
      const res = await runIntentAction("shifts.list_employee_positions", {});
      if (!res.ok) throw new Error(res.code);
      return res.data as EmployeePosition[];
    },
  });
  const links: EmployeePosition[] = query.data ?? [];
  return { ...query, links };
}
