"use client";

/**
 * react-query hook for one shopping list's items. Same shape as the shifts
 * hooks: the queryFn calls the SERVER action and turns a `!res.ok` into a thrown
 * Error so `isError` is real. The list screen reconciles the cache with
 * `setQueryData` after its own writes.
 */
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { runIntentAction } from "@/cortex/actions";
import type { Item } from "@/tools/shopping/logic";

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
