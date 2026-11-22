"use client";

/**
 * react-query hooks for the shopping tool's lists. Same shape as the shifts
 * hooks: the queryFn calls the SERVER action (session-built ctx on every call)
 * and turns a `!res.ok` into a thrown Error so `isError` is real.
 *
 * Every list lives in its own org (ARCHITECTURE.md #38). "My lists" reads them
 * all across the user's orgs; a list opens by id. `useShoppingList` (no id) is
 * the active org's list, kept for the Home card.
 */
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { runIntentAction } from "@/cortex/actions";
import type { List, ListSummary } from "@/tools/shopping/logic";

export const SHOPPING_LIST_KEY = ["shopping", "list"] as const;
export const SHOPPING_LISTS_KEY = ["shopping", "lists"] as const;
export const shoppingListKey = (id: string) => ["shopping", "list", id] as const;

/** "My lists": every list the user is in, across their orgs, by name. */
export function useShoppingLists() {
  const { locale } = useI18n();
  const query = useQuery({
    queryKey: SHOPPING_LISTS_KEY,
    queryFn: async (): Promise<ListSummary[]> => {
      const res = await runIntentAction("shopping.list_lists", {});
      if (!res.ok) throw new Error(res.code);
      return res.data as ListSummary[];
    },
  });
  const lists = [...(query.data ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name, locale, { sensitivity: "base" }),
  );
  return { ...query, lists };
}

/** One list by id (opened in place from "My lists"); null when not readable. */
export function useShoppingListById(id: string) {
  const query = useQuery({
    queryKey: shoppingListKey(id),
    queryFn: async (): Promise<List | null> => {
      const res = await runIntentAction("shopping.get_list", { id });
      if (!res.ok) throw new Error(res.code);
      return (res.data as List | null) ?? null;
    },
  });
  return { ...query, list: query.data ?? null };
}

/** The ACTIVE org's list — the Home card's read until it moves to "My lists". */
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
