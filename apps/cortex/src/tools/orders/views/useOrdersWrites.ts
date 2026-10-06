"use client";

/**
 * Every orders write in ONE place: call the server action, then reconcile the
 * shared react-query caches (suppliers / categories / products) so every view —
 * the card, each level, the suppliers manager — moves in lockstep with no refetch.
 *
 * Creates append the confirmed row. Updates and deletes are OPTIMISTIC and revert
 * to a snapshot on a real failure. Each function resolves to the failure code (or
 * null on success) so the caller decides how to surface it — never swallowed.
 *
 * In-flight guard: a second write for the same row while one is running is
 * ignored (resolves null without calling the server), so a double-tap can't
 * double-apply.
 */
import { useCallback, useRef } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { runIntentAction } from "@/cortex/actions";
import { SUPPLIERS_LIST_KEY } from "@/lib/query/useSuppliersList";
import { CATEGORIES_LIST_KEY, PRODUCTS_LIST_KEY } from "@/lib/query/useOrdersCatalog";
import type { Category, Product, Supplier } from "../logic";
import type { WriteErrorCode } from "./shared";

export type SupplierDraft = Pick<
  Supplier,
  "name" | "phone" | "contactName" | "email" | "notes"
> & { primaryCategoryId: string };

export type ProductDraft = Pick<Product, "name" | "categoryId" | "defaultUnit">;

export function useOrdersWrites() {
  const queryClient = useQueryClient();
  const inFlight = useRef<Set<string>>(new Set());

  /** Run `fn` unless `key` is already in flight. */
  const guarded = useCallback(
    async (key: string, fn: () => Promise<WriteErrorCode | null>) => {
      if (inFlight.current.has(key)) return null;
      inFlight.current.add(key);
      try {
        return await fn();
      } finally {
        inFlight.current.delete(key);
      }
    },
    [],
  );

  /** Optimistically map one list, revert to the snapshot if `write` fails. */
  const optimistic = useCallback(
    async <T,>(
      key: QueryKey,
      apply: (prev: T[]) => T[],
      write: () => ReturnType<typeof runIntentAction>,
    ): Promise<WriteErrorCode | null> => {
      const snapshot = queryClient.getQueryData<T[]>(key);
      queryClient.setQueryData<T[]>(key, (prev) => apply(prev ?? []));
      const res = await write();
      if (res.ok) return null;
      queryClient.setQueryData<T[]>(key, snapshot);
      return res.code;
    },
    [queryClient],
  );

  const append = useCallback(
    <T,>(key: QueryKey, row: T) => {
      queryClient.setQueryData<T[]>(key, (prev) => [...(prev ?? []), row]);
    },
    [queryClient],
  );

  // --- suppliers ------------------------------------------------------------
  const createSupplier = useCallback(
    async (draft: SupplierDraft): Promise<{ error: WriteErrorCode | null; id?: string }> => {
      const res = await runIntentAction("orders.create_supplier", draft);
      if (!res.ok) return { error: res.code };
      const { id, createdAt } = res.data as { id: string; createdAt: string };
      append<Supplier>(SUPPLIERS_LIST_KEY, { id, createdAt, ...draft });
      return { error: null, id };
    },
    [append],
  );

  const updateSupplier = useCallback(
    (id: string, draft: SupplierDraft) =>
      guarded(`supplier:${id}`, () =>
        optimistic<Supplier>(
          SUPPLIERS_LIST_KEY,
          (list) => list.map((s) => (s.id === id ? { ...s, ...draft } : s)),
          () => runIntentAction("orders.update_supplier", { id, ...draft }),
        ),
      ),
    [guarded, optimistic],
  );

  const deleteSupplier = useCallback(
    (id: string) =>
      guarded(`supplier:${id}`, async () => {
        // The DB cascades the supplier's products — mirror that in the products
        // cache too, restoring both if the delete is refused.
        const productsSnapshot = queryClient.getQueryData<Product[]>(PRODUCTS_LIST_KEY);
        queryClient.setQueryData<Product[]>(PRODUCTS_LIST_KEY, (prev) =>
          (prev ?? []).filter((p) => p.supplierId !== id),
        );
        const error = await optimistic<Supplier>(
          SUPPLIERS_LIST_KEY,
          (list) => list.filter((s) => s.id !== id),
          () => runIntentAction("orders.delete_supplier", { id }),
        );
        if (error) queryClient.setQueryData<Product[]>(PRODUCTS_LIST_KEY, productsSnapshot);
        return error;
      }),
    [guarded, optimistic, queryClient],
  );

  // --- categories -----------------------------------------------------------
  const createCategory = useCallback(
    async (name: string): Promise<{ error: WriteErrorCode | null; id?: string }> => {
      const res = await runIntentAction("orders.create_category", { name });
      if (!res.ok) return { error: res.code };
      const { id } = res.data as { id: string };
      append<Category>(CATEGORIES_LIST_KEY, { id, name, position: 0 });
      return { error: null, id };
    },
    [append],
  );

  const renameCategory = useCallback(
    (id: string, name: string) =>
      guarded(`category:${id}`, () =>
        optimistic<Category>(
          CATEGORIES_LIST_KEY,
          (list) => list.map((c) => (c.id === id ? { ...c, name } : c)),
          () => runIntentAction("orders.update_category", { id, name }),
        ),
      ),
    [guarded, optimistic],
  );

  const deleteCategory = useCallback(
    (id: string) =>
      guarded(`category:${id}`, () =>
        optimistic<Category>(
          CATEGORIES_LIST_KEY,
          (list) => list.filter((c) => c.id !== id),
          () => runIntentAction("orders.delete_category", { id }),
        ),
      ),
    [guarded, optimistic],
  );

  // --- products -------------------------------------------------------------
  const createProduct = useCallback(
    async (supplierId: string, draft: ProductDraft): Promise<WriteErrorCode | null> => {
      const res = await runIntentAction("orders.create_product", { supplierId, ...draft });
      if (!res.ok) return res.code;
      const { id } = res.data as { id: string };
      append<Product>(PRODUCTS_LIST_KEY, { id, supplierId, archived: false, ...draft });
      return null;
    },
    [append],
  );

  const updateProduct = useCallback(
    (id: string, draft: ProductDraft) =>
      guarded(`product:${id}`, () =>
        optimistic<Product>(
          PRODUCTS_LIST_KEY,
          (list) => list.map((p) => (p.id === id ? { ...p, ...draft } : p)),
          () => runIntentAction("orders.update_product", { id, ...draft }),
        ),
      ),
    [guarded, optimistic],
  );

  const deleteProduct = useCallback(
    (id: string) =>
      guarded(`product:${id}`, () =>
        optimistic<Product>(
          PRODUCTS_LIST_KEY,
          (list) => list.filter((p) => p.id !== id),
          () => runIntentAction("orders.delete_product", { id }),
        ),
      ),
    [guarded, optimistic],
  );

  return {
    createSupplier,
    updateSupplier,
    deleteSupplier,
    createCategory,
    renameCategory,
    deleteCategory,
    createProduct,
    updateProduct,
    deleteProduct,
  };
}
