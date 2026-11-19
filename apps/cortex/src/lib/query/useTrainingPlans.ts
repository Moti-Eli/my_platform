"use client";

/**
 * react-query hook for "My plans" — every workout plan the user is in, across
 * all their orgs (each plan lives in its own org — ARCHITECTURE.md #38). Same
 * shape as the other tool hooks: server action, `!res.ok` → thrown Error.
 */
import { useQuery } from "@tanstack/react-query";
import { runIntentAction } from "@/cortex/actions";
import type { Plan } from "@/tools/training/logic";

export const TRAINING_PLANS_KEY = ["training", "plans"] as const;

export function useTrainingPlans() {
  const query = useQuery({
    queryKey: TRAINING_PLANS_KEY,
    queryFn: async (): Promise<Plan[]> => {
      const res = await runIntentAction("training.list_plans", {});
      if (!res.ok) throw new Error(res.code);
      return (res.data as Plan[] | null) ?? [];
    },
  });
  const plans: Plan[] = query.data ?? [];
  return { ...query, plans };
}
