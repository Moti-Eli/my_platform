"use client";

/**
 * react-query hook for the manager's own submission questions (shifts stage 2,
 * part 7) — every question, in order, active and turned off. The manager's
 * screen edits this cache optimistically; the employee's screen shows the
 * active ones; the manager's answers sheet shows answered ones even when off.
 */
import { useQuery } from "@tanstack/react-query";
import { runIntentAction } from "@/cortex/actions";
import type { ShiftQuestion } from "@/tools/shifts/logic";

export const SHIFT_QUESTIONS_KEY = ["shifts", "questions"] as const;

export function useShiftQuestions() {
  const query = useQuery({
    queryKey: SHIFT_QUESTIONS_KEY,
    queryFn: async (): Promise<ShiftQuestion[]> => {
      const res = await runIntentAction("shifts.list_questions", {});
      if (!res.ok) throw new Error(res.code);
      return res.data as ShiftQuestion[];
    },
  });
  return { ...query, questions: query.data ?? [] };
}
