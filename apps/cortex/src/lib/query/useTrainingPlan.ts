"use client";

/**
 * react-query hook for the training tool's plan in the ACTIVE org. Same shape as
 * useShoppingList: the queryFn calls the SERVER action (session-built ctx on
 * every call) and turns a `!res.ok` into a thrown Error so `isError` is real.
 *
 * `plan` is null when the active org is not a plan org (every plan lives in its
 * own org — ARCHITECTURE.md #38).
 */
import { useQuery } from "@tanstack/react-query";
import { runIntentAction } from "@/cortex/actions";
import type { Plan } from "@/tools/training/logic";

export const TRAINING_PLAN_KEY = ["training", "plan"] as const;

export function useTrainingPlan() {
  const query = useQuery({
    queryKey: TRAINING_PLAN_KEY,
    queryFn: async (): Promise<Plan | null> => {
      const res = await runIntentAction("training.get_plan", {});
      if (!res.ok) throw new Error(res.code);
      return (res.data as Plan | null) ?? null;
    },
  });
  const plan: Plan | null = query.data ?? null;
  return { ...query, plan };
}
