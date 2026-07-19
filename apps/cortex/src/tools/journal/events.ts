/**
 * Journal — events (Standard §5).
 *
 * Emits: nothing (yet). Listens: nothing (yet).
 *
 * WHY A FACTORY, NOT A STATIC ARRAY: journal has no listeners today, but it keeps
 * the SAME shape notes/tasks use — `createJournalListeners(logic)` returning an
 * `AnyListener[]` — so server-runtime/runtime register every tool's listeners the
 * same way (`createJournalListeners(logic)`) with no per-tool special-casing. When
 * journal gains a cross-app reaction later, a listener's handler is (payload, ctx)
 * and receives NO db/logic, so it must CLOSE OVER the journal logic captured here —
 * which is exactly what this factory already threads through. Empty today, one
 * line away from wired.
 */
import { type AnyListener } from "@platform/cortex-core";
import type { JournalLogic } from "./logic";

export function createJournalListeners(_logic: JournalLogic): AnyListener[] {
  return [];
}
