/**
 * Candidates — events (Standard §5).
 *
 * Emits: nothing (yet). Listens: nothing (yet).
 *
 * WHY A FACTORY, NOT A STATIC ARRAY: candidates has no listeners today, but it
 * keeps the SAME shape notes/tasks use — `createCandidatesListeners(logic)`
 * returning an `AnyListener[]` — so server-runtime/runtime register every tool's
 * listeners the same way with no per-tool special-casing. When candidates gains a
 * cross-app reaction later, a listener's handler is (payload, ctx) and receives
 * NO db/logic, so it must CLOSE OVER the candidates logic captured here — which
 * is exactly what this factory already threads through. Empty today, one line
 * away from wired.
 */
import { type AnyListener } from "@platform/cortex-core";
import type { CandidatesLogic } from "./logic";

export function createCandidatesListeners(_logic: CandidatesLogic): AnyListener[] {
  return [];
}
