"use client";

/**
 * react-query hooks for shopping items. Same shape as the shifts hooks: the
 * queryFn calls the SERVER action and turns a `!res.ok` into a thrown Error so
 * `isError` is real. Screens reconcile the cache with `setQueryData` after their
 * own writes.
 *
 * `useListItems(listId)` — one list's items, A–Z (the list screen).
 * `useShoppingItems()` — the ACTIVE org's items in the order they were added,
 * kept for the Home card until it moves to "My lists".
 */
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { runIntentAction } from "@/cortex/actions";
import type { Item } from "@/tools/shopping/logic";

export const SHOPPING_ITEMS_KEY = ["shopping", "items"] as const;
export const listItemsKey = (listId: string) => ["shopping", "items", listId] as const;

/**
 * One list's items (opened in place from "My lists"), sorted A–Z by name in the
 * user's language, split into to-buy and bought.
 */
export function useListItems(listId: string) {
  const { locale } = useI18n();
  const query = useQuery({
    queryKey: listItemsKey(listId),
    queryFn: async (): Promise<Item[]> => {
      const res = await runIntentAction("shopping.list_items", { listId });
      if (!res.ok) throw new Error(res.code);
      return res.data as Item[];
    },
  });
  const items = [...(query.data ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name, locale, { sensitivity: "base", numeric: true }),
  );
  return {
    ...query,
    toBuy: items.filter((i) => !i.checked),
    bought: items.filter((i) => i.checked),
  };
}

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
