"use client";

/**
 * react-query hook for the org member list. Cloned from `useTasksList`.
 *
 * The queryFn calls the SERVER action `runIntentAction("staff.list_members")`,
 * which builds ctx from `requireSession()` on every call — so a react-query
 * background refetch is re-authenticated exactly like the first fetch. No identity
 * is passed from here; there is no field to pass.
 *
 * `runIntentAction` returns a discriminated result rather than throwing, so this
 * hook translates a `!res.ok` into a thrown Error(res.code): react-query only
 * treats a REJECTED queryFn as an error, and we want `isError` to reflect a denied
 * or failed read, not a resolved-but-empty success.
 *
 * BOTH staff views share this one cache entry: the dashboard card reads it and the
 * full screen reads it, so opening the full screen paints instantly from cache.
 */
import { useQuery } from "@tanstack/react-query";
import { runIntentAction } from "@/cortex/actions";
import type { Member } from "@/tools/staff/logic";

/** The single queryKey both staff views share. */
export const STAFF_MEMBERS_KEY = ["staff", "members"] as const;

export function useStaffMembers() {
  const query = useQuery({
    queryKey: STAFF_MEMBERS_KEY,
    queryFn: async (): Promise<Member[]> => {
      const res = await runIntentAction("staff.list_members", {});
      if (!res.ok) throw new Error(res.code);
      return res.data as Member[];
    },
  });

  // A typed, always-defined list so callers never branch on `data === undefined`.
  const members: Member[] = query.data ?? [];

  return { ...query, members };
}
