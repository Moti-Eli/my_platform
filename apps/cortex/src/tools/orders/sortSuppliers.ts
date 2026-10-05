/**
 * Display ordering for suppliers — shared by the dashboard card and the full
 * screen so the two can never disagree. Pure: returns a NEW array, never sorts
 * the shared cache in place.
 */
import type { Supplier } from "./logic";

export type SupplierSort = "name" | "newest";

export function sortSuppliers(
  suppliers: readonly Supplier[],
  sort: SupplierSort,
  locale: string,
): Supplier[] {
  const list = [...suppliers];
  if (sort === "newest") {
    // ISO timestamptz strings sort lexicographically in chronological order.
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  return list.sort((a, b) => a.name.localeCompare(b.name, locale, { sensitivity: "base" }));
}
