"use client";

/**
 * react-query hook for the tasks list. Cloned from `useInventoryStock`.
 *
 * The queryFn calls the SERVER action `runIntentAction("tasks.query_list")`,
 * which builds ctx from `requireSession()` on every call — so a react-query
 * background refetch is re-authenticated exactly like the first fetch. No identity
 * is passed from here; there is no field to pass.
 *
 * `runIntentAction` returns a discriminated result rather than throwing, so this
 * hook translates a `!res.ok` into a thrown Error(res.code): react-query only
 * treats a REJECTED queryFn as an error, and we want `isError` to reflect a denied
 * or failed read, not a resolved-but-empty success.
 *
 * BOTH tasks views share this one cache entry: the dashboard card reads it, and
 * the full screen reads it AND reconciles it via `setQueryData` after each write —
 * so a toggle or an add on the full screen is reflected on the card without a refetch.
 */
import { useQuery } from "@tanstack/react-query";
import { runIntentAction } from "@/cortex/actions";
import type { Task } from "@/tools/tasks/logic";

/** The single queryKey both tasks views share. Exported so callers reconciling
 * the cache with `setQueryData` use the IDENTICAL key — never a duplicated literal
 * that could silently drift out of sync with the query. */
export const TASKS_LIST_KEY = ["tasks", "list"] as const;

export function useTasksList() {
  const query = useQuery({
    queryKey: TASKS_LIST_KEY,
    queryFn: async (): Promise<Task[]> => {
      const res = await runIntentAction("tasks.query_list", {});
      if (!res.ok) throw new Error(res.code);
      return res.data as Task[];
    },
  });

  // A typed, always-defined list so callers never branch on `data === undefined`.
  const tasks: Task[] = query.data ?? [];

  return { ...query, tasks };
}
