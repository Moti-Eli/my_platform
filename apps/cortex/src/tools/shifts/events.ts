/**
 * Shifts — events (Standard §5).
 *
 * Emits: nothing (yet). Listens: nothing (yet). Same factory shape as orders so
 * the runtimes register every tool the same way.
 */
import { type AnyListener } from "@platform/cortex-core";
import type { ShiftsLogic } from "./logic";

export function createShiftsListeners(_logic: ShiftsLogic): AnyListener[] {
  return [];
}
