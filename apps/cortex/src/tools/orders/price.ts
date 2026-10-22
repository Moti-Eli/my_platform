/**
 * Product price — the text typed in the product form ↔ the number stored in
 * `supplier_products.price` (numeric(10,2), nullable, >= 0). Pure (no React, no
 * I/O), so the parsing rules can be checked on their own.
 *
 * The price is OPTIONAL: an empty field means "no price" (NULL). It is the
 * supplier's price per the product's unit, in shekels; no currency is stored.
 *
 *   ""        → null      (no price)
 *   "12"      → 12
 *   "12.5"    → 12.5
 *   "12,50"   → 12.5      (a comma is accepted as the decimal point)
 *   " ₪ 12 "  → 12        (a ₪ sign and spaces are ignored)
 *   "-3", "abc", "1.234", over PRICE_MAX → "invalid"
 */

/** The largest value numeric(10,2) holds. */
export const PRICE_MAX = 99_999_999.99;

const PRICE_PATTERN = /^\d+(\.\d{1,2})?$/;

/** Parse the form's text. `null` = no price; "invalid" = show an error. */
export function parsePrice(text: string): number | null | "invalid" {
  const cleaned = text.replace(/[\s₪]/gu, "").replace(",", ".");
  if (cleaned === "") return null;
  if (!PRICE_PATTERN.test(cleaned)) return "invalid";
  const value = Number(cleaned);
  return value <= PRICE_MAX ? value : "invalid";
}

/** A stored price → the form's text ('' for none). */
export function priceToText(price: number | null): string {
  return price == null ? "" : String(price);
}
