"use client";

/**
 * react-query hook for the time-entries list. Cloned from `useJournalList`.
 *
 * The queryFn calls the SERVER action `runIntentAction("time_entries.query_list")`,
 * which builds ctx from `requireSession()` on every call — so a react-query
 * background refetch is re-authenticated exactly like the first fetch. No identity
 * is passed from here; there is no field to pass.
 *
 * `runIntentAction` returns a discriminated result rather than throwing, so this
 * hook translates a `!res.ok` into a thrown Error(res.code): react-query only
 * treats a REJECTED queryFn as an error, and we want `isError` to reflect a denied
 * or failed read, not a resolved-but-empty success.
 *
 * BOTH time_entries views share this one cache entry: the dashboard card reads it,
 * and the full screen reads it AND reconciles it via `setQueryData` after each write
 * — so a create/edit/delete on the full screen is reflected on the card without a
 * refetch.
 */
import { useQuery } from "@tanstack/react-query";
import { runIntentAction } from "@/cortex/actions";
import type { TimeEntry } from "@/tools/time_entries/logic";

/** The single queryKey both time_entries views share. Exported so callers
 * reconciling the cache with `setQueryData` use the IDENTICAL key — never a
 * duplicated literal that could silently drift out of sync with the query. */
export const TIME_ENTRIES_LIST_KEY = ["time_entries", "list"] as const;

export function useTimeEntriesList() {
  const query = useQuery({
    queryKey: TIME_ENTRIES_LIST_KEY,
    queryFn: async (): Promise<TimeEntry[]> => {
      const res = await runIntentAction("time_entries.query_list", {});
      if (!res.ok) throw new Error(res.code);
      return res.data as TimeEntry[];
    },
  });

  // A typed, always-defined list so callers never branch on `data === undefined`.
  const entries: TimeEntry[] = query.data ?? [];

  return { ...query, entries };
}
