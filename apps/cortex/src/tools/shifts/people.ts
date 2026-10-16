/**
 * People rules — pure functions shared by the employees screen, the positions
 * screen (employee counts) and the add-employees picker, so "who is visible"
 * is decided in ONE place.
 *
 * VISIBLE = a shift_employees row whose user is still an ACTIVE org member.
 * Someone who left the org (soft-deleted membership) is not in the member list
 * at all, so their row is hidden — never deleted (agreed).
 */
import type { Employee, EmployeePosition, OrgMember } from "./logic";

export interface VisibleEmployee extends Employee {
  member: OrgMember;
}

/** The member's display name, falling back to the email's local part. */
export function memberName(m: OrgMember): string {
  const name = m.displayName?.trim();
  return name ? name : (m.email.split("@")[0] ?? m.email);
}

/** Employees still in the org, joined to their member record, A–Z by name. */
export function visibleEmployees(
  employees: readonly Employee[],
  members: readonly OrgMember[],
  locale: string,
): VisibleEmployee[] {
  const byUser = new Map(members.map((m) => [m.userId, m]));
  return employees
    .flatMap((e) => {
      const member = byUser.get(e.userId);
      return member ? [{ ...e, member }] : [];
    })
    .sort((a, b) =>
      memberName(a.member).localeCompare(memberName(b.member), locale, { sensitivity: "base" }),
    );
}

/** Active org members who are NOT in the tool yet, A–Z by name. */
export function membersNotInTool(
  members: readonly OrgMember[],
  employees: readonly Employee[],
  locale: string,
): OrgMember[] {
  const inTool = new Set(employees.map((e) => e.userId));
  return members
    .filter((m) => !inTool.has(m.userId))
    .sort((a, b) => memberName(a).localeCompare(memberName(b), locale, { sensitivity: "base" }));
}

/** How many VISIBLE employees can fill each position, keyed by position id. */
export function employeeCountByPosition(
  links: readonly EmployeePosition[],
  visible: readonly VisibleEmployee[],
): Map<string, number> {
  const visibleIds = new Set(visible.map((e) => e.id));
  const counts = new Map<string, number>();
  for (const link of links) {
    if (!visibleIds.has(link.employeeId)) continue;
    counts.set(link.positionId, (counts.get(link.positionId) ?? 0) + 1);
  }
  return counts;
}
