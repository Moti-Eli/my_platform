"use client";

/**
 * react-query hook for the items on the ACTIVE org's shopping list. Same shape as
 * the shifts hooks: the queryFn calls the SERVER action and turns a `!res.ok`
 * into a thrown Error so `isError` is real. Screens reconcile this cache entry
 * with `setQueryData` after their own writes.
 *
 * Returned in the order they were added (oldest first), split into the items
 * still to buy and the ones already checked off.
 */
import { useQuery } from "@tanstack/react-query";
import { runIntentAction } from "@/cortex/actions";
import type { Item } from "@/tools/shopping/logic";

export const SHOPPING_ITEMS_KEY = ["shopping", "items"] as const;

export function sortItems(list: readonly Item[]): Item[] {
  return [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function useShoppingItems() {
  const query = useQuery({
    queryKey: SHOPPING_ITEMS_KEY,
    queryFn: async (): Promise<Item[]> => {
      const res = await runIntentAction("shopping.list_items", {});
      if (!res.ok) throw new Error(res.code);
      return res.data as Item[];
    },
  });
  const items = sortItems(query.data ?? []);
  const toBuy = items.filter((i) => !i.checked);
  const bought = items.filter((i) => i.checked);
  return { ...query, toBuy, bought };
}
