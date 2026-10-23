/**
 * Shopping — events (Standard §5).
 *
 * Emits: nothing (yet). Listens: nothing (yet). Same factory shape as the other
 * tools so the runtimes register every tool the same way.
 */
import { type AnyListener } from "@platform/cortex-core";
import type { ShoppingLogic } from "./logic";

export function createShoppingListeners(_logic: ShoppingLogic): AnyListener[] {
  return [];
}
