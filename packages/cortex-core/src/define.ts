/**
 * Thin, typed factory helpers used by a tool's `intents.ts` / `events.ts`
 * (Cortex-SubApp-Standard.md §4, §5). They are identity functions whose only job
 * is to infer `TInput`/`TOutput` from the zod schemas (and `TPayload` for a
 * listener) so a tool's handlers are fully type-checked while the registry can
 * still hold them heterogeneously.
 */
import type { Ctx, Intent, Listener } from "./types";

/** Define a typed intent (input/output inferred from the zod schemas). */
export function defineIntent<TInput, TOutput>(
  intent: Intent<TInput, TOutput>,
): Intent<TInput, TOutput> {
  return intent;
}

/** Define a typed event listener for an event type. */
export function defineListener<TPayload>(
  eventType: string,
  handler: (payload: TPayload, ctx: Ctx) => Promise<void>,
): Listener<TPayload> {
  return { eventType, handler };
}
