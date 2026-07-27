"use server";

import { requireSession } from "@/lib/session";
import { buildCtx } from "@/cortex/build-ctx";
import { getServerRuntime } from "@/cortex/server-runtime";

/**
 * The result the client receives. Never a raw error message — always a stable
 * code the view maps to a translated string.
 */
export type IntentResult<T = unknown> =
  | { ok: true; data: T }
  | {
      ok: false;
      code:
        | "unavailable"
        | "denied"
        | "failed"
        | "emailExists"
        | "alreadyMember"
        // candidates.invite outcomes the card maps to distinct lines. Surfaced as
        // their own codes (not collapsed to "failed") so the invite panel can say
        // exactly what happened; see the mapping in runIntentAction.
        | "missingEmail"
        | "archived"
        | "provisionFailed";
    };

/**
 * ════════════════════════════════════════════════════════════════════════════
 * THIS ACTION BUILDS ctx ITSELF, FROM requireSession(). IT NEVER ACCEPTS ONE.
 * ════════════════════════════════════════════════════════════════════════════
 * There is intentionally no `ctx`, no `userId`, and no `orgId` parameter. That
 * missing parameter IS the defence, and it is the whole reason runIntent moved to
 * the server.
 *
 * If the client could pass an orgId, the user would be stating their own tenant.
 * RLS would still filter reads to what that user may see — but the TOOL's own
 * `org_id` filter (`query_stock` does `where org_id = ctx.orgId`) would run
 * against the CLIENT'S claim, and the mandatory `ai_log` row would record an
 * identity the user chose rather than the one they authenticated as. An audit
 * trail the subject can address to a different org is not an audit trail. Every
 * guarantee in the access model that keys on "the acting user's real org"
 * collapses in the single line where the server trusts a client-supplied ctx.
 *
 * So the server derives identity from the session cookie via `requireSession()`
 * (the same guard every page uses) and builds ctx from it. The client sends only
 * the intent name and its input — never who it is. There is no field to forge.
 * ════════════════════════════════════════════════════════════════════════════
 */
export async function runIntentAction(
  intentName: string,
  input: unknown
): Promise<IntentResult> {
  // Identity comes from the session, never from the caller. Redirects to /login
  // if there is no session.
  const session = await requireSession();
  const ctx = buildCtx(session);

  try {
    const runtime = await getServerRuntime();
    const data = await runtime.runIntent(intentName, input, ctx);
    return { ok: true, data };
  } catch (err) {
    // Map to a stable code; the raw message (which can name tables, columns, or
    // policy internals) never crosses to the client. Logged server-side only.
    console.error(`Cortex runIntentAction(${intentName}) failed`, err);
    const message = err instanceof Error ? err.message : String(err);

    // Specific, expected outcome of staff.add_member: the email is already
    // registered. addMemberToOrg returns "emailExists"; staff logic throws it as
    // the message. Surface a dedicated code so the form can say exactly that,
    // BEFORE the generic RLS/permission heuristics below (which would otherwise
    // never match this message, but keep this explicit and first regardless).
    if (/emailExists/.test(message)) {
      return { ok: false, code: "emailExists" };
    }

    // Expected outcome of staff.add_member when the email belongs to an existing
    // identity ALREADY in this org: addMemberToOrg links rather than creates, and
    // returns "alreadyMember" on the UNIQUE(user_id, organization_id) conflict.
    // Same treatment as emailExists — a dedicated code, mapped BEFORE the heuristics.
    if (/alreadyMember/.test(message)) {
      return { ok: false, code: "alreadyMember" };
    }

    // Expected outcomes of candidates.invite (inviteCandidateCore throws its stable
    // key; invite-logic re-throws it). Each is a dedicated code so the invite panel
    // can render a specific line — mapped BEFORE the generic RLS/permission
    // heuristics, which would otherwise swallow them into "unavailable"/"failed".
    if (/missingEmail/.test(message)) {
      return { ok: false, code: "missingEmail" };
    }
    if (/archived/.test(message)) {
      return { ok: false, code: "archived" };
    }
    if (/provisionFailed/.test(message)) {
      return { ok: false, code: "provisionFailed" };
    }

    // A write to a tool table is denied by grants until the write step lands —
    // `authenticated` has no INSERT/UPDATE on inventory_items. That is expected,
    // not a fault: surface it as "unavailable" so the view can say "not yet".
    if (
      /row-level security|permission denied|not allowed|violates|insufficient/i.test(message)
    ) {
      return { ok: false, code: "unavailable" };
    }
    // Manifest-permission / missing-identity denials from the data-layer.
    if (/permission|denied|missing userid/i.test(message)) {
      return { ok: false, code: "denied" };
    }
    return { ok: false, code: "failed" };
  }
}
