"use client";

/**
 * react-query hook for the inventory stock list.
 *
 * The queryFn calls the SERVER action `runIntentAction("inventory.query_stock")`,
 * which builds ctx from `requireSession()` on every call — so a react-query
 * background refetch is re-authenticated exactly like the first fetch. No identity
 * is passed from here; there is no field to pass.
 *
 * `runIntentAction` returns a discriminated result rather than throwing, so this
 * hook translates a `!res.ok` into a thrown Error(res.code): react-query only
 * treats a REJECTED queryFn as an error, and we want `isError` to reflect a denied
 * or failed read, not a resolved-but-empty success.
 *
 * NOT wired into any view yet — this is step 1, proving the layer exists.
 */
import { useQuery } from "@tanstack/react-query";
import { runIntentAction } from "@/cortex/actions";
import type { InventoryItem } from "@/tools/inventory/logic";

export function useInventoryStock() {
  const query = useQuery({
    queryKey: ["inventory", "stock"],
    queryFn: async (): Promise<InventoryItem[]> => {
      const res = await runIntentAction("inventory.query_stock", {});
      if (!res.ok) throw new Error(res.code);
      return res.data as InventoryItem[];
    },
  });

  // A typed, always-defined list so callers never branch on `data === undefined`.
  const items: InventoryItem[] = query.data ?? [];

  return { ...query, items };
}
