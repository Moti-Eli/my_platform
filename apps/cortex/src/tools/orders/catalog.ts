/**
 * Catalog rules — pure functions shared by every orders view (dashboard card,
 * the three navigation levels, the suppliers manager), so "which supplier shows
 * in which category" is decided in exactly ONE place.
 *
 * A supplier is IN a category when EITHER:
 *   - the category is its primary category (visible even with zero products), OR
 *   - it has at least one non-archived product in that category.
 */
import type { Product, Supplier } from "./logic";

/** Locale-aware A–Z by name — the only ordering anywhere in the tool. */
export function byName<T extends { name: string }>(items: readonly T[], locale: string): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, locale, { sensitivity: "base" }));
}

export function activeProducts(products: readonly Product[]): Product[] {
  return products.filter((p) => !p.archived);
}

/** Suppliers that appear under `categoryId` (see file header). */
export function suppliersInCategory(
  categoryId: string,
  suppliers: readonly Supplier[],
  products: readonly Product[],
): Supplier[] {
  const withProducts = new Set(
    activeProducts(products)
      .filter((p) => p.categoryId === categoryId)
      .map((p) => p.supplierId),
  );
  return suppliers.filter((s) => s.primaryCategoryId === categoryId || withProducts.has(s.id));
}

/** Non-archived products of one supplier, optionally within one category. */
export function productsOf(
  products: readonly Product[],
  supplierId: string,
  categoryId?: string,
): Product[] {
  return activeProducts(products).filter(
    (p) => p.supplierId === supplierId && (categoryId === undefined || p.categoryId === categoryId),
  );
}

/**
 * Why a category cannot be deleted, or null if it can. Mirrors the DB's two
 * ON DELETE RESTRICT foreign keys (products → category, suppliers' primary →
 * category) so the button is disabled up front instead of failing on the server.
 * Archived products count too — the FK does not know about `archived`.
 */
export function categoryDeleteBlock(
  categoryId: string,
  suppliers: readonly Supplier[],
  products: readonly Product[],
): "hasProducts" | "isPrimary" | null {
  if (products.some((p) => p.categoryId === categoryId)) return "hasProducts";
  if (suppliers.some((s) => s.primaryCategoryId === categoryId)) return "isPrimary";
  return null;
}

/** Case/whitespace-insensitive name match, for the "already exists" check. */
export function sameName(a: string, b: string, locale: string): boolean {
  return a.trim().localeCompare(b.trim(), locale, { sensitivity: "base" }) === 0;
}
