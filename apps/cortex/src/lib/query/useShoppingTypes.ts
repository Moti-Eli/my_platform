"use client";

/**
 * react-query hook for the user's OWN shopping list types (personal — no org)
 * and which type each of their lists carries. Same shape as the other shopping
 * hooks.
 *
 * NEVER BLOCKS THE LISTS: `available` is false while the types tables are not
 * migrated (the server says so), while loading, AND on any read error — the
 * screens then simply show the lists without types.
 */
import { useQuery } from "@tanstack/react-query";
import { runIntentAction } from "@/cortex/actions";
import type { ListType, ListTypes } from "@/tools/shopping/logic";

export const SHOPPING_TYPES_KEY = ["shopping", "types"] as const;

export function useShoppingTypes() {
  const query = useQuery({
    queryKey: SHOPPING_TYPES_KEY,
    queryFn: async (): Promise<ListTypes> => {
      const res = await runIntentAction("shopping.list_types", {});
      if (!res.ok) throw new Error(res.code);
      return res.data as ListTypes;
    },
  });
  const data = query.isError ? null : (query.data ?? null);
  const types: ListType[] = data?.types ?? [];
  const links = data?.links ?? {};
  const byId = new Map(types.map((t) => [t.id, t]));

  return {
    ...query,
    /** Types can be shown and edited (tables exist, read succeeded). */
    available: data?.available === true,
    types,
    /** The user's type for a list, or null. */
    typeOf: (listId: string): ListType | null => {
      const typeId = links[listId];
      return typeId ? (byId.get(typeId) ?? null) : null;
    },
  };
}
