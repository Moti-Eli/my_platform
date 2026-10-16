/**
 * Notes — events (Standard §5).
 *
 * Emits: nothing (yet). Listens: nothing (yet).
 *
 * WHY A FACTORY, NOT A STATIC ARRAY: notes has no listeners today, but it keeps
 * the SAME shape tasks uses — `createNotesListeners(logic)` returning an
 * `AnyListener[]` — so server-runtime/runtime register every tool's listeners the
 * same way (`createNotesListeners(logic)`) with no per-tool special-casing. When
 * notes gains a cross-app reaction later, a listener's handler is (payload, ctx)
 * and receives NO db/logic, so it must CLOSE OVER the notes logic captured here —
 * which is exactly what this factory already threads through. Empty today, one
 * line away from wired.
 */
import { type AnyListener } from "@platform/cortex-core";
import type { NotesLogic } from "./logic";

export function createNotesListeners(_logic: NotesLogic): AnyListener[] {
  return [];
}
