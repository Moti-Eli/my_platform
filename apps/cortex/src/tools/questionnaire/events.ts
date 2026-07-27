/**
 * Questionnaire — events (Standard §5).
 *
 * Emits: nothing. Listens: nothing.
 *
 * WHY A FACTORY, NOT A STATIC ARRAY: questionnaire has no listeners, but it keeps
 * the SAME shape the other tools use — `createQuestionnaireListeners(logic)`
 * returning `AnyListener[]` — so server-runtime/runtime register every tool's
 * listeners identically, no per-tool special-casing. If a cross-app reaction is
 * ever added, a listener's handler is (payload, ctx) and receives NO db/logic, so
 * it must CLOSE OVER the logic captured here — which this factory already threads.
 */
import { type AnyListener } from "@platform/cortex-core";
import type { QuestionnaireLogic } from "./logic";

export function createQuestionnaireListeners(_logic: QuestionnaireLogic): AnyListener[] {
  return [];
}
