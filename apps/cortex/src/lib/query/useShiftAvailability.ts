"use client";

/**
 * react-query hook for the EMPLOYEE's own week in the shifts tool (stage 2):
 * the week's deadline settings, their submission and their marks, in one server
 * call (`shifts.my_week`). Same shape as the other shifts hooks; the screen
 * reconciles marks into this cache after each tap (`setQueryData`).
 *
 * Keyed by the week's Sunday. Disabled until the screen knows which week (it
 * reads "this week" only after hydration).
 */
import { useQuery } from "@tanstack/react-query";
import { runIntentAction } from "@/cortex/actions";
import type { MyWeek } from "@/tools/shifts/logic";

export const myWeekKey = (weekStart: string) => ["shifts", "myWeek", weekStart] as const;

export function useMyWeek(weekStart: string | null) {
  const query = useQuery({
    queryKey: myWeekKey(weekStart ?? ""),
    enabled: weekStart !== null,
    queryFn: async (): Promise<MyWeek> => {
      const res = await runIntentAction("shifts.my_week", { weekStart });
      // The code travels as the Error message, so the screen can tell
      // "tables not migrated yet" (schemaMissing) from a plain failure.
      if (!res.ok) throw new Error(res.code);
      return res.data as MyWeek;
    },
  });
  return { ...query, myWeek: query.data ?? null };
}
