/**
 * The data-layer — "the one door" (Standard §7; core prompt task 4).
 *
 * `runIntent` is the ONLY way the AI (or any caller) reads/writes tool data.
 * Every call runs the same fixed pipeline:
 *
 *   1. resolve the intent from the registry (by `<appId>.<action>`);
 *   2. zod-validate the input;
 *   3. enforce the manifest's permissions (`assertPermissions(ctx, appId)`);
 *   4. run the tool's handler with the ready-made ctx;
 *   5. write the mandatory `ai_log` audit row;
 *   6. zod-validate the output and return it.
 *
 * No SQL lives here except the `ai_log` write, which goes through the provided
 * {@link CortexDb}. Handlers get their own db client by closure (§7), never
 * through this layer.
 */

import type { Ctx } from "./types";
import { getIntent, getApp, appIdOf } from "./registry";
import type { CortexDb } from "./db";

/** Thrown when `runIntent` is asked for an intent that no tool registered. */
export class IntentNotFoundError extends Error {
  constructor(public readonly intentName: string) {
    super(`Cortex data-layer: no registered intent named '${intentName}'.`);
    this.name = "IntentNotFoundError";
  }
}

/** Thrown by an `assertPermissions` implementation when a call is not allowed. */
export class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(`Cortex data-layer: ${message}`);
    this.name = "PermissionDeniedError";
  }
}

/**
 * Enforces the manifest's access rules for a call. The shell injects the real
 * implementation (reading `app.manifest.permissions` / `.roles` and resolving
 * the acting user's effective permissions via `@platform/auth`). It may be sync
 * or async; it must throw (ideally {@link PermissionDeniedError}) to deny.
 */
export type PermissionChecker = (ctx: Ctx, appId: string) => void | Promise<void>;

/**
 * The core's built-in permission check. The core alone cannot resolve a user's
 * effective permissions/roles — that requires `@platform/auth` and a live
 * session — so this only *fails closed* on the checks it can make locally:
 *   - the intent's owning app must actually be registered, and
 *   - the ctx must carry an identity.
 * The shell replaces this with a full RBAC check via {@link DataLayerOptions}.
 */
export const defaultAssertPermissions: PermissionChecker = (ctx, appId) => {
  if (!getApp(appId)) {
    throw new PermissionDeniedError(`no manifest registered for app '${appId}'.`);
  }
  if (!ctx.userId) {
    throw new PermissionDeniedError("missing userId in ctx.");
  }
};

/** Options for {@link createDataLayer}. */
export interface DataLayerOptions {
  /** Where the mandatory `ai_log` audit row is written (Standard §7). */
  db: CortexDb;
  /**
   * Manifest-permission enforcement. Defaults to {@link defaultAssertPermissions};
   * the shell should pass a full RBAC-backed checker.
   */
  assertPermissions?: PermissionChecker;
}

/** The data-layer surface returned by {@link createDataLayer}. */
export interface DataLayer {
  runIntent<TOutput = unknown>(intentName: string, input: unknown, ctx: Ctx): Promise<TOutput>;
}

/**
 * Build a data-layer bound to a db client (for the `ai_log` write) and a
 * permission checker. Returns `runIntent`, the one door.
 */
export function createDataLayer({
  db,
  assertPermissions = defaultAssertPermissions,
}: DataLayerOptions): DataLayer {
  async function runIntent<TOutput = unknown>(
    intentName: string,
    input: unknown,
    ctx: Ctx,
  ): Promise<TOutput> {
    // 1. Resolve the intent (from all registered tools).
    const intent = getIntent(intentName);
    if (!intent) throw new IntentNotFoundError(intentName);

    // 2. Validate input (zod). Throws ZodError on a bad shape.
    const parsed = intent.input.parse(input);

    // 3. Enforce the manifest's permissions before the handler runs.
    await assertPermissions(ctx, appIdOf(intent.name));

    // 4. Run the tool with a ready ctx (it never fetches ctx itself).
    const result = await intent.handler(parsed, ctx);

    // 5. Mandatory audit: every read/write through the door is logged.
    //    (Written after the handler so the result is captured too; the column
    //    exists on ai_log and this stays a superset of the Standard's sketch.)
    await db.insert("ai_log", {
      user_id: ctx.userId,
      intent: intentName,
      target_instance_id: ctx.instanceId,
      input: parsed,
      result,
    });

    // 6. Validate output (zod) and return.
    return intent.output.parse(result) as TOutput;
  }

  return { runIntent };
}
