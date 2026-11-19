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
import type { MyWeek, OpenWeeks, WeekOverview } from "@/tools/shifts/logic";

export const OPEN_WEEKS_KEY = ["shifts", "openWeeks"] as const;

/** The weeks still open for submitting (the server applies the deadline rule). */
export function useOpenWeeks() {
  const query = useQuery({
    queryKey: OPEN_WEEKS_KEY,
    queryFn: async (): Promise<OpenWeeks> => {
      const res = await runIntentAction("shifts.open_weeks", {});
      if (!res.ok) throw new Error(res.code);
      return res.data as OpenWeeks;
    },
  });
  return { ...query, openWeeks: query.data?.weeks ?? null };
}

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

export const weekOverviewKey = (weekStart: string) => ["shifts", "weekOverview", weekStart] as const;

/** The MANAGER's view of a week — everyone's submissions and marks. */
export function useWeekOverview(weekStart: string | null) {
  const query = useQuery({
    queryKey: weekOverviewKey(weekStart ?? ""),
    enabled: weekStart !== null,
    queryFn: async (): Promise<WeekOverview> => {
      const res = await runIntentAction("shifts.week_overview", { weekStart });
      if (!res.ok) throw new Error(res.code);
      return res.data as WeekOverview;
    },
  });
  return { ...query, overview: query.data ?? null };
}
