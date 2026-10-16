"use client";

/**
 * react-query hook for the candidates list. Cloned from `useNotesList`.
 *
 * The queryFn calls the SERVER action `runIntentAction("candidates.query_list")`,
 * which builds ctx from `requireSession()` on every call — so a react-query
 * background refetch is re-authenticated exactly like the first fetch. No identity
 * is passed from here; there is no field to pass.
 *
 * `runIntentAction` returns a discriminated result rather than throwing, so this
 * hook translates a `!res.ok` into a thrown Error(res.code): react-query only
 * treats a REJECTED queryFn as an error, and we want `isError` to reflect a denied
 * or failed read, not a resolved-but-empty success.
 *
 * BOTH candidates views share this one cache entry: the dashboard card reads it,
 * and the full screen reads it AND reconciles it via `setQueryData` after each
 * write — so a create/edit/stage-move/delete on the full screen is reflected on
 * the card without a refetch.
 */
import { useQuery } from "@tanstack/react-query";
import { runIntentAction } from "@/cortex/actions";
// The row type. `Candidate` now carries `candidateUserId` (string | null — null
// until the candidate is invited), so every row this hook returns includes it; the
// column rides through query_list's zod output like every other field. The card
// reads it only to label the invite control (invite vs. re-send link).
import type { Candidate } from "@/tools/candidates/logic";

/** The single queryKey both candidates views share. Exported so callers
 * reconciling the cache with `setQueryData` use the IDENTICAL key — never a
 * duplicated literal that could silently drift out of sync with the query. */
export const CANDIDATES_LIST_KEY = ["candidates", "list"] as const;

export function useCandidatesList() {
  const query = useQuery({
    queryKey: CANDIDATES_LIST_KEY,
    queryFn: async (): Promise<Candidate[]> => {
      const res = await runIntentAction("candidates.query_list", {});
      if (!res.ok) throw new Error(res.code);
      return res.data as Candidate[];
    },
  });

  // A typed, always-defined list so callers never branch on `data === undefined`.
  const candidates: Candidate[] = query.data ?? [];

  return { ...query, candidates };
}
