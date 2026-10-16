"use client";

/**
 * react-query hook for the journal list. Cloned from `useNotesList`.
 *
 * The queryFn calls the SERVER action `runIntentAction("journal.query_list")`,
 * which builds ctx from `requireSession()` on every call — so a react-query
 * background refetch is re-authenticated exactly like the first fetch. No identity
 * is passed from here; there is no field to pass.
 *
 * `runIntentAction` returns a discriminated result rather than throwing, so this
 * hook translates a `!res.ok` into a thrown Error(res.code): react-query only
 * treats a REJECTED queryFn as an error, and we want `isError` to reflect a denied
 * or failed read, not a resolved-but-empty success.
 *
 * BOTH journal views share this one cache entry: the dashboard card reads it, and
 * the full screen reads it AND reconciles it via `setQueryData` after each write —
 * so a create/edit/delete on the full screen is reflected on the card without a refetch.
 */
import { useQuery } from "@tanstack/react-query";
import { runIntentAction } from "@/cortex/actions";
import type { Entry } from "@/tools/journal/logic";

/** The single queryKey both journal views share. Exported so callers reconciling
 * the cache with `setQueryData` use the IDENTICAL key — never a duplicated literal
 * that could silently drift out of sync with the query. */
export const JOURNAL_LIST_KEY = ["journal", "list"] as const;

export function useJournalList() {
  const query = useQuery({
    queryKey: JOURNAL_LIST_KEY,
    queryFn: async (): Promise<Entry[]> => {
      const res = await runIntentAction("journal.query_list", {});
      if (!res.ok) throw new Error(res.code);
      return res.data as Entry[];
    },
  });

  // A typed, always-defined list so callers never branch on `data === undefined`.
  const entries: Entry[] = query.data ?? [];

  return { ...query, entries };
}
