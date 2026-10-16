"use client";

/**
 * react-query hook for the orders tool's supplier list. Cloned from `useNotesList`.
 *
 * The queryFn calls the SERVER action `runIntentAction("orders.list_suppliers")`,
 * which builds ctx from `requireSession()` on every call — so a background refetch
 * is re-authenticated exactly like the first fetch. No identity is passed from here.
 *
 * Every orders view shares this one cache entry; writes reconcile it through
 * `useOrdersWrites` (setQueryData), never a refetch.
 */
import { useQuery } from "@tanstack/react-query";
import { runIntentAction } from "@/cortex/actions";
import type { Supplier } from "@/tools/orders/logic";

/** The single queryKey every orders view shares — exported so `setQueryData`
 * callers use the IDENTICAL key, never a duplicated literal. */
export const SUPPLIERS_LIST_KEY = ["orders", "suppliers"] as const;

export function useSuppliersList() {
  const query = useQuery({
    queryKey: SUPPLIERS_LIST_KEY,
    queryFn: async (): Promise<Supplier[]> => {
      const res = await runIntentAction("orders.list_suppliers", {});
      if (!res.ok) throw new Error(res.code);
      return res.data as Supplier[];
    },
  });

  // A typed, always-defined list so callers never branch on `data === undefined`.
  const suppliers: Supplier[] = query.data ?? [];

  return { ...query, suppliers };
}
