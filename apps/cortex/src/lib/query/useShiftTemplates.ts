"use client";

/**
 * react-query hook for the shifts tool's weekly shift templates. Same shape as
 * the other shifts hooks (server action per read; `!ok` becomes a thrown Error).
 *
 * "Copy a day to all days" rewrites most rows at once, so after it the screens
 * INVALIDATE this key (and the requirements key) rather than patching the cache.
 */
import { useQuery } from "@tanstack/react-query";
import { runIntentAction } from "@/cortex/actions";
import type { ShiftTemplate } from "@/tools/shifts/logic";

export const SHIFT_TEMPLATES_KEY = ["shifts", "templates"] as const;
/** Reserved for part 4's requirements hook — invalidated by "copy to all days". */
export const SHIFT_REQUIREMENTS_KEY = ["shifts", "requirements"] as const;

/** One day's shifts in display order: by start time, then name. */
export function shiftsOfDay(
  templates: readonly ShiftTemplate[],
  weekday: number,
  locale: string,
): ShiftTemplate[] {
  return templates
    .filter((t) => t.weekday === weekday)
    .sort(
      (a, b) =>
        a.startTime.localeCompare(b.startTime) ||
        a.name.localeCompare(b.name, locale, { sensitivity: "base" }),
    );
}

export function useShiftTemplates() {
  const query = useQuery({
    queryKey: SHIFT_TEMPLATES_KEY,
    queryFn: async (): Promise<ShiftTemplate[]> => {
      const res = await runIntentAction("shifts.list_templates", {});
      if (!res.ok) throw new Error(res.code);
      return res.data as ShiftTemplate[];
    },
  });
  const templates: ShiftTemplate[] = query.data ?? [];
  return { ...query, templates };
}
