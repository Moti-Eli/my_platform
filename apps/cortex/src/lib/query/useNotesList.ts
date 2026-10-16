"use client";

/**
 * react-query hook for the notes list. Cloned from `useTasksList`.
 *
 * The queryFn calls the SERVER action `runIntentAction("notes.query_list")`,
 * which builds ctx from `requireSession()` on every call — so a react-query
 * background refetch is re-authenticated exactly like the first fetch. No identity
 * is passed from here; there is no field to pass.
 *
 * `runIntentAction` returns a discriminated result rather than throwing, so this
 * hook translates a `!res.ok` into a thrown Error(res.code): react-query only
 * treats a REJECTED queryFn as an error, and we want `isError` to reflect a denied
 * or failed read, not a resolved-but-empty success.
 *
 * BOTH notes views share this one cache entry: the dashboard card reads it, and
 * the full screen reads it AND reconciles it via `setQueryData` after each write —
 * so a create/edit/delete on the full screen is reflected on the card without a refetch.
 */
import { useQuery } from "@tanstack/react-query";
import { runIntentAction } from "@/cortex/actions";
import type { Note } from "@/tools/notes/logic";

/** The single queryKey both notes views share. Exported so callers reconciling
 * the cache with `setQueryData` use the IDENTICAL key — never a duplicated literal
 * that could silently drift out of sync with the query. */
export const NOTES_LIST_KEY = ["notes", "list"] as const;

export function useNotesList() {
  const query = useQuery({
    queryKey: NOTES_LIST_KEY,
    queryFn: async (): Promise<Note[]> => {
      const res = await runIntentAction("notes.query_list", {});
      if (!res.ok) throw new Error(res.code);
      return res.data as Note[];
    },
  });

  // A typed, always-defined list so callers never branch on `data === undefined`.
  const notes: Note[] = query.data ?? [];

  return { ...query, notes };
}
