"use client";

/**
 * react-query hooks for the orders tool's catalog: categories and products.
 * Cloned from `useSuppliersList` (same server-action read, same "throw on !ok so
 * isError is real" translation). Every orders view shares these cache entries and
 * reconciles them via `setQueryData` after its own writes.
 *
 * Products are loaded ORG-WIDE in one read (not per supplier/category): a
 * restaurant's catalog is small, and the navigation levels, counts and the
 * "can this category be deleted" check all derive from the same list client-side.
 */
import { useQuery } from "@tanstack/react-query";
import { runIntentAction } from "@/cortex/actions";
import type { Category, Product } from "@/tools/orders/logic";

export const CATEGORIES_LIST_KEY = ["orders", "categories"] as const;
export const PRODUCTS_LIST_KEY = ["orders", "products"] as const;

export function useCategoriesList() {
  const query = useQuery({
    queryKey: CATEGORIES_LIST_KEY,
    queryFn: async (): Promise<Category[]> => {
      const res = await runIntentAction("orders.list_categories", {});
      if (!res.ok) throw new Error(res.code);
      return res.data as Category[];
    },
  });
  const categories: Category[] = query.data ?? [];
  return { ...query, categories };
}

export function useProductsList() {
  const query = useQuery({
    queryKey: PRODUCTS_LIST_KEY,
    queryFn: async (): Promise<Product[]> => {
      const res = await runIntentAction("orders.list_products", {});
      if (!res.ok) throw new Error(res.code);
      return res.data as Product[];
    },
  });
  const products: Product[] = query.data ?? [];
  return { ...query, products };
}
