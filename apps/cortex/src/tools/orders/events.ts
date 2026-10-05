/**
 * Orders — events (Standard §5).
 *
 * Emits: nothing (yet). Listens: nothing (yet).
 *
 * Same factory shape as notes (`createOrdersListeners(logic)` returning an
 * `AnyListener[]`) so the runtimes register every tool the same way. A future
 * `orders.received` → inventory reaction would close over the logic captured here.
 */
import { type AnyListener } from "@platform/cortex-core";
import type { OrdersLogic } from "./logic";

export function createOrdersListeners(_logic: OrdersLogic): AnyListener[] {
  return [];
}
