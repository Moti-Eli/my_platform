/**
 * Staffing helpers — pure, shared by the shift list (summary line), the shift
 * edit screen (steppers) and the positions screen (delete block), so "what does
 * this shift need" is computed in ONE place.
 */
import type { Position, ShiftRequirement } from "./logic";

/** How many of `positionId` the shift needs (0 when there is no row). */
export function requiredCount(
  requirements: readonly ShiftRequirement[],
  templateId: string,
  positionId: string,
): number {
  return (
    requirements.find((r) => r.templateId === templateId && r.positionId === positionId)
      ?.requiredCount ?? 0
  );
}

/**
 * The shift's needs in POSITION ORDER (positions already sorted by the caller),
 * skipping "not needed" — the data behind "Waiter ×3 · Cook ×2".
 */
export function shiftNeeds(
  requirements: readonly ShiftRequirement[],
  templateId: string,
  sortedPositions: readonly Position[],
): Array<{ name: string; count: number }> {
  return sortedPositions.flatMap((p) => {
    const count = requiredCount(requirements, templateId, p.id);
    return count > 0 ? [{ name: p.name, count }] : [];
  });
}

/** How many shifts require each position — a position in use can't be deleted. */
export function shiftsRequiringPosition(
  requirements: readonly ShiftRequirement[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of requirements) counts.set(r.positionId, (counts.get(r.positionId) ?? 0) + 1);
  return counts;
}
