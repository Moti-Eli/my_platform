"use client";

/**
 * react-query hook for the shopping tool's list in the ACTIVE org. Same shape as
 * the shifts hooks: the queryFn calls the SERVER action (session-built ctx on
 * every call) and turns a `!res.ok` into a thrown Error so `isError` is real.
 *
 * `list` is null when the active org is not a list org (every list lives in its
 * own org — ARCHITECTURE.md #38).
 */
import { useQuery } from "@tanstack/react-query";
import { runIntentAction } from "@/cortex/actions";
import type { List } from "@/tools/shopping/logic";

export const SHOPPING_LIST_KEY = ["shopping", "list"] as const;

export function useShoppingList() {
  const query = useQuery({
    queryKey: SHOPPING_LIST_KEY,
    queryFn: async (): Promise<List | null> => {
      const res = await runIntentAction("shopping.get_list", {});
      if (!res.ok) throw new Error(res.code);
      return (res.data as List | null) ?? null;
    },
  });
  const list: List | null = query.data ?? null;
  return { ...query, list };
}
