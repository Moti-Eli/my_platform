/**
 * Build the `Ctx` every intent handler and event listener runs under.
 *
 * `userId` and `orgId` now come from the REAL SESSION — `requireSession()` in
 * `src/lib/session.ts`, called by each protected page, which passes them down as
 * props. There are no hard-coded identifiers left in this file: if you are
 * holding a `Ctx`, a guard ran above you to produce it.
 *
 * WHY THIS FILE STILL EXISTS, AND WHEN IT DISAPPEARS
 * -------------------------------------------------
 * `instanceId`. It is audit metadata only (see `Ctx` in @platform/cortex-core) —
 * "which installed tool did this" — and it is NULL, because there is nothing yet
 * to put in it: installed apps live in localStorage, `app_instances` has zero
 * rows, and inventing a uuid would violate `events.emitted_by_instance` /
 * `ai_log.target_instance_id`'s FK the moment a real adapter replaces the
 * in-memory one. When installed-apps moves off localStorage and real
 * `app_instances` rows exist, `instanceId` comes from the selected instance and
 * THIS FILE DELETES ENTIRELY — `Ctx` becomes something the shell composes
 * directly from the session and the instance, with nothing left to help with.
 */
import type { Ctx } from "@platform/cortex-core";
import type { Session } from "@/lib/session";

/**
 * Compose a `Ctx` from a guard-produced session.
 *
 * Takes {@link Session} rather than two loose strings on purpose: the only way
 * to get a `Session` is `requireSession()`, so the type itself records that a
 * guard ran. Pure and dependency-free, so client components can call it.
 */
export function buildCtx(session: Session): Ctx {
  return {
    userId: session.userId,
    orgId: session.orgId,
    // Audit metadata only, and never a scoping key. Null until installed-apps
    // moves off localStorage — see the header.
    instanceId: null,
  };
}
