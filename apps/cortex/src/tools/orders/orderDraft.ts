"use client";

/**
 * The order being put together for ONE supplier — which products are ticked,
 * how many, in which unit, plus the optional delivery date and note — kept in
 * THIS BROWSER (localStorage), one entry per supplier, until it is sent. Nothing
 * here touches the database (orders are not stored yet).
 *
 * A tiny external store (`useSyncExternalStore`) rather than per-component
 * state: the products screen ticks items while the floating "To order (X)"
 * button — rendered elsewhere — counts them, and both must see the same draft
 * the instant it changes.
 *
 * Hydration-safe: the server snapshot is always the EMPTY draft, so the first
 * client paint matches the server HTML; the stored draft appears right after.
 * Every storage access is wrapped — private mode / blocked storage just means
 * the draft lives in memory for this page view.
 */
import { useCallback, useSyncExternalStore } from "react";

export interface DraftItem {
  /** As typed — "1.5", "3" (comma already turned into a dot). Parsed on use. */
  qty: string;
  /** A unit key from units.ts, or '' for none. Defaults to the product's unit. */
  unit: string;
}

export interface OrderDraft {
  /** Ticked products, keyed by product id. */
  items: Record<string, DraftItem>;
  /** "YYYY-MM-DD" from a date input, or ''. */
  deliveryDate: string;
  note: string;
  /** Set when "Send on WhatsApp" was tapped — drives the "Was it sent?" question. */
  sentAt: string | null;
}

const EMPTY: OrderDraft = Object.freeze({
  items: Object.freeze({}) as Record<string, DraftItem>,
  deliveryDate: "",
  note: "",
  sentAt: null,
}) as OrderDraft;

const keyFor = (supplierId: string) => `cortex.orders.draft.${supplierId}`;

/** In-memory snapshots — the same object is returned until it changes, as
 * useSyncExternalStore requires. */
const cache = new Map<string, OrderDraft>();
const listeners = new Set<() => void>();

function read(supplierId: string): OrderDraft {
  const hit = cache.get(supplierId);
  if (hit) return hit;
  let draft = EMPTY;
  try {
    const raw = window.localStorage.getItem(keyFor(supplierId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<OrderDraft>;
      // Defensive about old/corrupt data: keep only well-formed fields.
      const items: Record<string, DraftItem> = {};
      for (const [id, item] of Object.entries(parsed.items ?? {})) {
        if (item && typeof item.qty === "string" && typeof item.unit === "string") {
          items[id] = { qty: item.qty, unit: item.unit };
        }
      }
      draft = {
        items,
        deliveryDate: typeof parsed.deliveryDate === "string" ? parsed.deliveryDate : "",
        note: typeof parsed.note === "string" ? parsed.note : "",
        sentAt: typeof parsed.sentAt === "string" ? parsed.sentAt : null,
      };
    }
  } catch {
    // Unavailable or corrupt storage → start empty.
  }
  cache.set(supplierId, draft);
  return draft;
}

function write(supplierId: string, next: OrderDraft) {
  cache.set(supplierId, next);
  try {
    const empty = Object.keys(next.items).length === 0 && !next.deliveryDate && !next.note && !next.sentAt;
    if (empty) window.localStorage.removeItem(keyFor(supplierId));
    else window.localStorage.setItem(keyFor(supplierId), JSON.stringify(next));
  } catch {
    // Storage unavailable — the in-memory snapshot still works for this view.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The draft for one supplier, plus every way to change it. */
export function useOrderDraft(supplierId: string) {
  const draft = useSyncExternalStore(
    subscribe,
    () => read(supplierId),
    () => EMPTY,
  );

  const update = useCallback(
    (fn: (d: OrderDraft) => OrderDraft) => write(supplierId, fn(read(supplierId))),
    [supplierId],
  );

  return {
    draft,
    /** Tick (with qty 1 and the product's unit) or untick a product. */
    toggle: useCallback(
      (productId: string, defaultUnit: string) =>
        update((d) => {
          const items = { ...d.items };
          if (items[productId]) delete items[productId];
          else items[productId] = { qty: "1", unit: defaultUnit };
          return { ...d, items };
        }),
      [update],
    ),
    setItem: useCallback(
      (productId: string, patch: Partial<DraftItem>) =>
        update((d) => {
          const current = d.items[productId];
          if (!current) return d;
          return { ...d, items: { ...d.items, [productId]: { ...current, ...patch } } };
        }),
      [update],
    ),
    remove: useCallback(
      (productId: string) =>
        update((d) => {
          const items = { ...d.items };
          delete items[productId];
          return { ...d, items };
        }),
      [update],
    ),
    setDeliveryDate: useCallback(
      (deliveryDate: string) => update((d) => ({ ...d, deliveryDate })),
      [update],
    ),
    setNote: useCallback((note: string) => update((d) => ({ ...d, note })), [update]),
    markSent: useCallback(
      () => update((d) => ({ ...d, sentAt: new Date().toISOString() })),
      [update],
    ),
    clearSent: useCallback(() => update((d) => ({ ...d, sentAt: null })), [update]),
    /** After "Yes, it was sent": forget this supplier's draft entirely. */
    clear: useCallback(() => update(() => EMPTY), [update]),
  };
}

/** Parse a typed quantity ("1.5", "3"); null if it isn't a positive number. */
export function parseQty(qty: string): number | null {
  if (!/^\d+(\.\d+)?$/.test(qty.trim())) return null;
  const n = Number(qty);
  return n > 0 ? n : null;
}
