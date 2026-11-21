"use client";

/**
 * react-query hook for the training days of the ACTIVE org's plan (every plan
 * lives in its own org — ARCHITECTURE.md #38), in display order. Same shape as
 * the other tool hooks: server action, `!res.ok` → thrown Error.
 */
import { useQuery } from "@tanstack/react-query";
import { runIntentAction } from "@/cortex/actions";
import type { Day } from "@/tools/training/logic";

export const TRAINING_DAYS_KEY = ["training", "days"] as const;

export function useTrainingDays() {
  const query = useQuery({
    queryKey: TRAINING_DAYS_KEY,
    queryFn: async (): Promise<Day[]> => {
      const res = await runIntentAction("training.list_days", {});
      if (!res.ok) throw new Error(res.code);
      return (res.data as Day[] | null) ?? [];
    },
  });
  const days: Day[] = query.data ?? [];
  return { ...query, days };
}
