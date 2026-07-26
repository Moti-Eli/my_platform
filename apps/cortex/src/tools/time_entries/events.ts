/**
 * Time entries — events (Standard §5).
 *
 * Emits: nothing (yet). Listens: nothing (yet).
 *
 * WHY A FACTORY, NOT A STATIC ARRAY: time_entries has no listeners today, but it
 * keeps the SAME shape notes/journal use — `createTimeEntriesListeners(logic)`
 * returning an `AnyListener[]` — so server-runtime/runtime register every tool's
 * listeners the same way with no per-tool special-casing. When time_entries gains
 * a cross-app reaction later, a listener's handler is (payload, ctx) and receives
 * NO db/logic, so it must CLOSE OVER the logic captured here — which is exactly
 * what this factory already threads through. Empty today, one line away from wired.
 */
import { type AnyListener } from "@platform/cortex-core";
import type { TimeEntriesLogic } from "./logic";

export function createTimeEntriesListeners(_logic: TimeEntriesLogic): AnyListener[] {
  return [];
}
