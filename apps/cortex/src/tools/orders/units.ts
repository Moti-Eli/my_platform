/**
 * Units of measure — the CLOSED list, kept in CODE, not as a DB enum.
 *
 * `supplier_products.default_unit` (and, in stage 3, the order line's unit) is a
 * plain text column holding one of these KEYS. Adding a unit = one line here + its
 * i18n label; no migration.
 *
 * RULE: never DELETE a key from this list — rows already store it. To retire a
 * unit, stop offering it in pickers instead. An unknown key still renders (as the
 * raw key) rather than breaking.
 */
import type { MessageKey } from "@/i18n";

export const UNIT_KEYS = ["kg", "unit", "liter", "pack", "carton"] as const;
export type UnitKey = (typeof UNIT_KEYS)[number];

const UNIT_LABEL_KEYS: Record<UnitKey, MessageKey> = {
  kg: "orders.unitKg",
  unit: "orders.unitUnit",
  liter: "orders.unitLiter",
  pack: "orders.unitPack",
  carton: "orders.unitCarton",
};

/** Plural forms, for quantities other than exactly 1 ("3 חבילות", "1.5 ק"ג"). */
const UNIT_PLURAL_KEYS: Record<UnitKey, MessageKey> = {
  kg: "orders.unitKgMany",
  unit: "orders.unitUnitMany",
  liter: "orders.unitLiterMany",
  pack: "orders.unitPackMany",
  carton: "orders.unitCartonMany",
};

export function isUnitKey(value: string): value is UnitKey {
  return (UNIT_KEYS as readonly string[]).includes(value);
}

/** The i18n label key for a stored unit, or null for '' / an unknown key. */
export function unitLabelKey(value: string): MessageKey | null {
  return isUnitKey(value) ? UNIT_LABEL_KEYS[value] : null;
}

/** Singular for exactly 1, plural otherwise; null for '' / an unknown key. */
export function unitLabelKeyFor(value: string, quantity: number): MessageKey | null {
  if (!isUnitKey(value)) return null;
  return quantity === 1 ? UNIT_LABEL_KEYS[value] : UNIT_PLURAL_KEYS[value];
}
