/**
 * inviteCandidate — THE ATOMIC PROVISIONING SEQUENCE.
 *
 * FRAMEWORK-FREE ON PURPOSE. No `next/*`, no `"use server"`, no `"server-only"`.
 * EVERYTHING is injected (`deps`), so this exact function runs unchanged in two
 * places: the server intent seam (via candidates/invite-logic.ts) AND the
 * verification harness (packages/db/scripts/verify-invite-candidate.ts), which
 * imports it directly and drives it against the real local stack. The only runtime
 * dependency is `@platform/auth` (itself framework-free) and node's crypto.
 *
 * THE ORDER IS THE DESIGN — each step, and why it is where it is:
 *   (a) read the candidate through the RLS client: the candidates permission gate
 *       (`candidates.access`) + RLS decide the caller's rights for free.
 *   (b) already linked → idempotent RESEND: "invite" and "resend link" are one
 *       action, so a second invite just re-issues a fresh link, creating nothing.
 *   (c) provision the isolated child org + candidate user (createChildOrgWithMember).
 *   (d) snapshot the questionnaire into the child org, owned by the candidate user.
 *   (d.5) INSTALL the questionnaire tool for the new user in the child org (one
 *       app_instances row) so it appears — and opens — the moment they land.
 *   (e) THE COMMIT POINT, deliberately LAST: link the record to its new user. A
 *       failure at (d), (d.5) or (e) compensates (best-effort) and reports
 *       provisionFailed, so a failed invite never leaves an orphan org / user /
 *       answers / install behind.
 *   (f) mint OUR OWN portal link from the recovery `hashed_token` — never GoTrue's
 *       action_link (which points at /auth/v1/verify, not our /set-password flow).
 *       The link's `next` nests the onward target: /set-password?next=/tools/questionnaire.
 *
 * COMPENSATION ORDER — org FIRST, then user — AND WHY IT DIFFERS FROM @platform/auth.
 * The auth package's own rollback deletes the auth user THEN the org, because in its
 * flows nothing else references the new user. Here it would BREAK: once (d) has run,
 * `candidate_answers.owner_id -> public.users` (NO ACTION) references the candidate
 * user, and deleting the auth user cascades to `public.users`, which those answer
 * rows would BLOCK. Deleting the child org first clears the answers (and the child
 * memberships/roles) via `org_id ON DELETE CASCADE`, leaving the user safe to delete.
 * The app_instances row (d.5) is cleaned by the SAME cascade — app_instances.org_id
 * is also ON DELETE CASCADE (20260716000002) — so it needs no extra compensation delete.
 */
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@platform/db";
import { createChildOrgWithMember } from "@platform/auth";
import { QUESTION_BANK } from "./questions";

/** The two clients, NOT interchangeable (same split as createChildOrgWithMember). */
export interface InviteCandidateDeps {
  /** Actor-scoped (their JWT). The candidate read, the parent-org gate inside
   *  createChildOrgWithMember, and the commit UPDATE all run on this. */
  rlsDb: SupabaseClient;
  /** Service-role (bypasses RLS). Provisioning writes, the answers snapshot, the
   *  recovery-link mint, and any compensation delete run on this. */
  serviceDb: SupabaseClient;
}

export interface InviteCandidateInput {
  /** The candidate RECORD id (public.candidates.id), not a user id. */
  candidateId: string;
  /** The recruiter's ACTIVE org — the PARENT under which the child org is created.
   *  Comes from the session's ctx, never the caller. */
  activeOrgId: string;
  /** Origin the portal link is built against, e.g. "https://app.example.com". */
  baseUrl: string;
}

/**
 * Either a short, stable error key or the successful result. On the provisioning
 * path `organizationId`/`userId` are the freshly-created child org + candidate user;
 * on the idempotent resend path they are omitted (nothing was created).
 */
export type InviteCandidateResult =
  | { error: string }
  | { link: string; organizationId?: string; userId?: string };

export async function inviteCandidateCore(
  deps: InviteCandidateDeps,
  input: InviteCandidateInput,
): Promise<InviteCandidateResult> {
  const { rlsDb, serviceDb } = deps;
  const { candidateId, activeOrgId, baseUrl } = input;

  // (a) Read the candidate through the RLS client. The permission gate + RLS
  //     enforce the caller's rights: an unreadable row (denied or absent) is
  //     "notFound" to the caller — we never distinguish, on purpose.
  const readRes = await rlsDb
    .from("candidates")
    .select("id, name, email, stage, candidate_user_id")
    .eq("id", candidateId)
    .maybeSingle();
  if (readRes.error) return { error: "notFound" };
  const row = readRes.data as {
    id: string;
    name: string;
    email: string | null;
    stage: string;
    candidate_user_id: string | null;
  } | null;
  if (!row) return { error: "notFound" };

  const email = (row.email ?? "").trim();
  if (email === "") return { error: "missingEmail" };
  if (row.stage === "archived") return { error: "archived" };

  // (f) — factored out because both the resend path (b) and the provisioning tail
  //     use it. Builds OUR portal link from the recovery hashed_token; the raw
  //     action_link is never handed out.
  const issueLink = async (): Promise<InviteCandidateResult> => {
    const gen = await serviceDb.auth.admin.generateLink({ type: "recovery", email });
    const hashed = gen.data?.properties?.hashed_token;
    if (gen.error || !hashed) return { error: "linkFailed" };
    // Nested onward target: /confirm verifies the OTP then forwards to
    // /set-password, which after the password (or a skip) forwards to the
    // questionnaire — so a fresh candidate lands straight on the tool they were
    // invited to fill. The inner value is urlencoded as ONE `next` param.
    const innerNext = "/set-password?next=/tools/questionnaire";
    const link =
      `${baseUrl}/confirm?token_hash=${encodeURIComponent(hashed)}` +
      `&type=recovery&next=${encodeURIComponent(innerNext)}`;
    return { link };
  };

  // (b) Already provisioned → RESEND only. Skip (c)–(e) entirely; invite is
  //     idempotent, so a second call just re-issues a fresh link.
  if (row.candidate_user_id) {
    return issueLink();
  }

  // (c) Provision the isolated child org + candidate user. Password is a random
  //     24-byte base64url secret (node crypto, NOT randomUUID) — never disclosed;
  //     the candidate sets their own via the recovery link.
  const password = randomBytes(24).toString("base64url");
  const provisioned = await createChildOrgWithMember(rlsDb, serviceDb, {
    organizationName: row.name,
    parentOrganizationId: activeOrgId,
    email,
    displayName: row.name,
    password,
  });
  if (provisioned.error || !provisioned.organizationId || !provisioned.userId) {
    // emailExists maps to its own key; every other seam error surfaces as-is.
    return {
      error: provisioned.error === "emailExists" ? "emailExists" : provisioned.error ?? "provisionFailed",
    };
  }
  const childOrgId = provisioned.organizationId;
  const userId = provisioned.userId;

  // Best-effort compensation. ORG FIRST, THEN USER — see the header: the answers'
  // NO ACTION FK to public.users would otherwise block deleting the user.
  const compensate = async (): Promise<void> => {
    await serviceDb.from("organizations").delete().eq("id", childOrgId);
    await serviceDb.auth.admin.deleteUser(userId);
  };

  // (d) Snapshot the questionnaire into the child org, owned by the candidate user.
  //     Service client: the answers INSERT policy pins owner_id = auth.uid(), which
  //     a service caller (no JWT) can't satisfy, so this privileged write bypasses
  //     RLS exactly like the provisioning writes above.
  const answerRows = QUESTION_BANK.map((q) => ({
    org_id: childOrgId,
    owner_id: userId,
    question_key: q.key,
    question_text: q.text,
    position: q.position,
    answer: "",
  }));
  const answersRes = await serviceDb.from("candidate_answers").insert(answerRows);
  if (answersRes.error) {
    await compensate();
    return { error: "provisionFailed" };
  }

  // (d.5) INSTALL the questionnaire tool for the new user in the child org — ONE
  //       app_instances row, so the tool is present and openable the instant they
  //       land. Service client (app_instances has no client write policy). Resolve
  //       the definition by its SEEDED key (20260727000002): a MISSING seed row is a
  //       hard configuration error — compensate and fail rather than half-provision.
  //       No extra compensation delete: app_instances.org_id ON DELETE CASCADE means
  //       deleting the child org (compensate does, first) removes this row too.
  const defRes = await serviceDb
    .from("app_definitions")
    .select("id")
    .eq("key", "questionnaire")
    .maybeSingle();
  const definitionId = (defRes.data as { id: string } | null)?.id;
  if (defRes.error || !definitionId) {
    await compensate();
    return { error: "provisionFailed" };
  }
  const instRes = await serviceDb.from("app_instances").insert({
    definition_id: definitionId,
    owner_id: userId,
    org_id: childOrgId,
  });
  if (instRes.error) {
    await compensate();
    return { error: "provisionFailed" };
  }

  // (e) THE COMMIT POINT. Link the record to its new user, through the RLS client so
  //     the DB re-decides the write against the real actor. Zero rows updated means
  //     RLS refused — a failure, same as an error, and it triggers compensation.
  const linkRes = await rlsDb
    .from("candidates")
    .update({ candidate_user_id: userId })
    .eq("id", candidateId)
    .select("id");
  if (linkRes.error || (linkRes.data ?? []).length === 0) {
    await compensate();
    return { error: "provisionFailed" };
  }

  // (f)/(g) Mint the link. Note: a link failure here does NOT roll back — the
  //     account is committed and valid, and the idempotent resend path can mint a
  //     fresh link any time. We surface the link error without undoing (c)–(e).
  const linkResult = await issueLink();
  if ("error" in linkResult) return linkResult;
  return { link: linkResult.link, organizationId: childOrgId, userId };
}
