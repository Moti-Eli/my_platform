"use client";

/**
 * react-query hook for every exercise of the ACTIVE org's plan (all its days,
 * each day's exercises in display order). One read serves the day screen
 * (filtered by day) and the plan screen's per-day counts. Same shape as the
 * other tool hooks: server action, `!res.ok` → thrown Error.
 */
import { useQuery } from "@tanstack/react-query";
import { runIntentAction } from "@/cortex/actions";
import type { Exercise } from "@/tools/training/logic";

export const TRAINING_EXERCISES_KEY = ["training", "exercises"] as const;

export function useTrainingExercises() {
  const query = useQuery({
    queryKey: TRAINING_EXERCISES_KEY,
    queryFn: async (): Promise<Exercise[]> => {
      const res = await runIntentAction("training.list_exercises", {});
      if (!res.ok) throw new Error(res.code);
      return (res.data as Exercise[] | null) ?? [];
    },
  });
  const exercises: Exercise[] = query.data ?? [];
  return { ...query, exercises };
}
