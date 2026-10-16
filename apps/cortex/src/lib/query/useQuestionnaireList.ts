"use client";

/**
 * react-query hook for the questionnaire list. Cloned from `useTimeEntriesList`.
 *
 * The queryFn calls the SERVER action `runIntentAction("questionnaire.query_list")`,
 * which builds ctx from `requireSession()` on every call — so a background refetch
 * is re-authenticated exactly like the first fetch. No identity is passed from here;
 * there is no field to pass.
 *
 * `runIntentAction` returns a discriminated result rather than throwing, so this
 * hook translates a `!res.ok` into a thrown Error(res.code): react-query only treats
 * a REJECTED queryFn as an error, and we want `isError` to reflect a denied/failed
 * read, not a resolved-but-empty success.
 *
 * BOTH questionnaire views share this one cache entry: the dashboard card reads it,
 * and the full screen reads it AND reconciles it via `setQueryData` after each
 * answer — so a save on the full screen updates the card's answered count without a
 * refetch.
 */
import { useQuery } from "@tanstack/react-query";
import { runIntentAction } from "@/cortex/actions";
import type { QuestionnaireRow } from "@/tools/questionnaire/logic";

/** The single queryKey both questionnaire views share. Exported so callers
 * reconciling the cache with `setQueryData` use the IDENTICAL key — never a
 * duplicated literal that could silently drift out of sync with the query. */
export const QUESTIONNAIRE_LIST_KEY = ["questionnaire", "list"] as const;

export function useQuestionnaireList() {
  const query = useQuery({
    queryKey: QUESTIONNAIRE_LIST_KEY,
    queryFn: async (): Promise<QuestionnaireRow[]> => {
      const res = await runIntentAction("questionnaire.query_list", {});
      if (!res.ok) throw new Error(res.code);
      return res.data as QuestionnaireRow[];
    },
  });

  // A typed, always-defined list so callers never branch on `data === undefined`.
  const rows: QuestionnaireRow[] = query.data ?? [];

  return { ...query, rows };
}
