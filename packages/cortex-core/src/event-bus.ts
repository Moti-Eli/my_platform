/**
 * The event-bus (Standard §7; core prompt task 5).
 *
 * `emit(type, payload, ctx)` first persists the event to the `events` table,
 * then dispatches it to every registered listener for that type. The emitter is
 * fully decoupled from listeners — it names an event type, not a recipient — so
 * a tool triggers chain reactions in other tools without ever referencing them
 * (Standard §1 law 3).
 *
 * Dispatch is synchronous / in-process for now (listeners run in registration
 * order, awaited one after another). Moving to an async/queued fan-out later is
 * an internal change behind this same signature.
 */

import type { Ctx } from "./types";
import { getListeners } from "./registry";
import type { CortexDb } from "./db";

/** The event-bus surface returned by {@link createEventBus}. */
export interface EventBus {
  emit(type: string, payload: unknown, ctx: Ctx): Promise<void>;
}

/**
 * Build an event-bus bound to a db client (for persisting to `events`).
 *
 * The persisted row maps the ctx onto the shell's `events` columns:
 * `org_id = ctx.orgId`, `user_id = ctx.userId`, and
 * `emitted_by_instance = ctx.instanceId`.
 *
 * `org_id` is NOT NULL (20260717000002) and is what scopes the row — the read
 * policy is `is_member_of_tree(org_id)`, with no `user_id` escape hatch, so an
 * event is readable by the emitting org's tree and nobody else.
 * `emitted_by_instance` is audit metadata only (nullable — see {@link Ctx}):
 * "which installed tool emitted this", never a scoping key.
 */
export function createEventBus(db: CortexDb): EventBus {
  async function emit(type: string, payload: unknown, ctx: Ctx): Promise<void> {
    // 1. Persist first — the event log is the source of truth, independent of
    //    whether any listener happens to be registered.
    await db.insert("events", {
      type,
      payload,
      emitted_by_instance: ctx.instanceId,
      org_id: ctx.orgId,
      user_id: ctx.userId,
    });

    // 2. Dispatch to all subscribers of this type (in-process, in order).
    for (const listener of getListeners(type)) {
      await listener.handler(payload, ctx);
    }
  }

  return { emit };
}
