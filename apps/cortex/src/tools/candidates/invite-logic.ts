/**
 * Candidates — the SERVER WIRING for the privileged `candidates.invite` intent.
 *
 * SERVER-ONLY. This is the seam between the framework-free {@link inviteCandidateCore}
 * (which knows nothing about requests, cookies, or env) and the runtime that has
 * those: it resolves the actor's RLS client, the service client, and the base URL,
 * then calls the core. It is `"server-only"` and imports node-crypto-bearing code,
 * so it must NEVER be pulled into the client bundle — which is why the client
 * runtime injects a throwing stub for `invite` instead of importing this (mirrors
 * staff's server-only add_member).
 *
 * WHY THE CORE LIVES SEPARATELY: keeping the sequence framework-free lets the
 * verification harness import and drive it directly against the local stack, with
 * no Next runtime — see packages/db/scripts/verify-invite-candidate.ts.
 */
import "server-only";

import type { SupabaseClient } from "@platform/db";
import type { Ctx } from "@platform/cortex-core";
import { inviteCandidateCore } from "./invite-core";

/** The intent input — just the candidate RECORD id; org comes from ctx, never the caller. */
export interface InviteCandidateIntentInput {
  candidateId: string;
}

/**
 * Build the `invite` implementation the candidates logic delegates to. Takes the
 * same per-user RLS-client factory + service client the rest of the server runtime
 * uses, plus a per-call base-URL resolver (env override, else request origin).
 */
export function createCandidatesInvite({
  getRls,
  service,
  getBaseUrl,
}: {
  getRls: () => Promise<SupabaseClient>;
  service: SupabaseClient;
  getBaseUrl: () => Promise<string>;
}) {
  return async function invite(
    input: InviteCandidateIntentInput,
    ctx: Ctx,
  ): Promise<{ link: string }> {
    const rlsDb = await getRls();
    const baseUrl = await getBaseUrl();
    const res = await inviteCandidateCore(
      { rlsDb, serviceDb: service },
      { candidateId: input.candidateId, activeOrgId: ctx.orgId, baseUrl },
    );
    // The core returns a stable error key; throw it so runIntentAction maps it to a
    // client code (emailExists is already handled there), exactly like staff.add_member.
    if ("error" in res) throw new Error(res.error);
    return { link: res.link };
  };
}
