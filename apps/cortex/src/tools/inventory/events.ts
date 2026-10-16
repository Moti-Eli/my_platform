/**
 * Inventory — events (Standard §5).
 *
 * Emits (fired from logic.ts via the event-bus; each persists to the `events`
 * table before any listener runs):
 *   'inventory.updated' → { product, quantity }
 *   'inventory.low'     → { product, quantity, threshold }
 *
 * Listens: nothing yet. (A future 'orders.received' listener would add delivered
 * stock — the emitting tool stays decoupled from whoever listens.)
 */
import type { AnyListener } from "@platform/cortex-core";

export const listeners: AnyListener[] = [];
