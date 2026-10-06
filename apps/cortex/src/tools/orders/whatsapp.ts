/**
 * Sending an order over WhatsApp — pure functions, no React, so each rule can be
 * checked on its own:
 *
 *   toWhatsAppNumber  — a supplier phone as typed → the digits wa.me needs
 *   buildOrderMessage — the exact text the supplier receives
 *   whatsAppLink      — https://wa.me/<number>?text=<message>
 *
 * The MESSAGE IS ALWAYS HEBREW, whatever language the app is in: its wording
 * lives in i18n (orders.msg*) but is always read from the Hebrew dictionary.
 */
import { dictionaries, translate, type MessageKey } from "@/i18n";
import { unitLabelKeyFor } from "./units";

/**
 * Phone as typed → international digits for wa.me (no "+", no leading 0), or
 * null when it can't be a valid number.
 *
 *   "+972 50-123-4567" → 972501234567   ("+" → digits as they are)
 *   "00972501234567"   → 972501234567   (leading 00 dropped)
 *   "972501234567"     → 972501234567   (already international)
 *   "050-1234567"      → 972501234567   (leading 0 → ASSUMED Israeli)
 *   "+972 050-1234567" → 972501234567   (stray local 0 after 972 dropped)
 *
 * Fewer than 9 digits left → null (treated like a supplier with no phone).
 * Limits no code can fix: a landline passes but has no WhatsApp; a foreign
 * number saved with a leading 0 gets Israel's prefix — store those with "+".
 */
export function toWhatsAppNumber(phone: string): string | null {
  const trimmed = phone.trim();
  const plus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (!plus) {
    if (digits.startsWith("00")) digits = digits.slice(2);
    else if (digits.startsWith("0")) digits = `972${digits.slice(1)}`;
  }
  // "+972 050-…" — a local 0 kept after the country code — is a common way of
  // writing it; WhatsApp needs it gone.
  if (digits.startsWith("9720")) digits = `972${digits.slice(4)}`;
  return digits.length >= 9 ? digits : null;
}

export function whatsAppLink(number: string, message: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

/** "3", "1.5" — no trailing zeros. */
export function formatQty(n: number): string {
  return String(Number(n.toFixed(3)));
}

/** "YYYY-MM-DD" → "יום חמישי, 9.10" (weekday + day.month, no year), in Hebrew. */
export function formatDeliveryDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return "";
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const weekday = new Intl.DateTimeFormat("he-IL", { weekday: "long" }).format(date);
  return `${weekday}, ${date.getDate()}.${date.getMonth() + 1}`;
}

export interface MessageLine {
  name: string;
  qty: number;
  /** Unit key, or '' — then only the number is shown. */
  unit: string;
}

/** Hebrew text from the i18n dictionary, with {placeholders} filled in. */
function he(key: MessageKey, vars: Record<string, string> = {}): string {
  let text = translate(dictionaries.he, key);
  // A function replacer, so a "$" in a name or note is inserted literally.
  for (const [k, v] of Object.entries(vars)) text = text.replace(`{${k}}`, () => v);
  return text;
}

/**
 * The order message, exactly as the supplier sees it:
 *
 *   שלום <supplier>,
 *   הזמנה מ<org>:
 *
 *   - מוצרלה – 3 חבילות
 *   - ריקוטה – 4
 *
 *   לאספקה: יום חמישי, 9.10      ← only if a date was chosen
 *   הערה: …                      ← only if a note was written
 *
 *   תודה!
 */
export function buildOrderMessage({
  supplierName,
  orgName,
  lines,
  deliveryDate,
  note,
}: {
  supplierName: string;
  orgName: string;
  lines: MessageLine[];
  deliveryDate: string;
  note: string;
}): string {
  const items = lines.map((l) => {
    const unitKey = unitLabelKeyFor(l.unit, l.qty);
    const qty = formatQty(l.qty);
    return unitKey
      ? he("orders.msgItem", { name: l.name, qty, unit: he(unitKey) })
      : he("orders.msgItemNoUnit", { name: l.name, qty });
  });

  const date = formatDeliveryDate(deliveryDate);
  const extras = [
    date ? he("orders.msgDelivery", { date }) : null,
    note.trim() ? he("orders.msgNote", { note: note.trim() }) : null,
  ].filter((x): x is string => x !== null);

  const blocks = [
    [
      he("orders.msgGreeting", { supplier: supplierName }),
      orgName ? he("orders.msgFrom", { org: orgName }) : he("orders.msgFromNoOrg"),
    ],
    items,
    extras,
    [he("orders.msgThanks")],
  ].filter((block) => block.length > 0);

  return blocks.map((block) => block.join("\n")).join("\n\n");
}
