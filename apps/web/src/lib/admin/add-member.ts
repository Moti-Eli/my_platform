// SERVER-ONLY. This module reaches the secret-key admin client (via the
// `server-only` admin module), so it must never be imported by client code.
import "server-only";

import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@platform/db";
import { getCurrentUser, hasPermission } from "@platform/auth";
import { captureException, logger } from "@platform/observability";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Shared privileged "add a user to an organization" flow — the single home for
 * this logic, called by BOTH the web server action and the mobile-facing API
 * route handler (zero duplication of the privileged path).
 *
 * SECURITY (see ARCHITECTURE.md #16 and #26):
 * - `authClient` MUST be authenticated as the acting user (cookie session on
 *   web, Bearer-token-scoped client on the API). We re-check `members.manage`
 *   in the TARGET org on that RLS-scoped client FIRST — this is the security
 *   boundary and it also enforces tenant isolation (an Org A admin cannot create
 *   users in Org B, because `hasPermission` is false there).
 * - Only AFTER that check do we construct the secret-key admin client.
 * - Atomic-ish: the auth user is created first; any later failure deletes it
 *   again (FK `ON DELETE CASCADE` removes profile/membership/role).
 */
export interface AddMemberInput {
  email: string;
  displayName: string;
  /** "admin" | "member". */
  targetRole: string;
  organizationId: string;
}

export interface AddMemberResult {
  /** An i18n key under the "members" namespace, or null on success. */
  error: string | null;
  /** The new user's id on success; null otherwise. */
  userId: string | null;
}

/** DB CHECK caps names at 200 raw chars (see SCHEMA.md). Reject before the DB. */
const MAX_NAME_LEN = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Dev-only known temp password so the demo can log in immediately; production
 * mints a random, never-disclosed one (NODE_ENV gate — ARCHITECTURE.md #16).
 */
const DEV_TEMP_PASSWORD = "123456";
function newUserPassword(): string {
  if (process.env.NODE_ENV === "production") return randomBytes(24).toString("base64url");
  return DEV_TEMP_PASSWORD;
}

/** Heuristic: does this Supabase error mean "that email is already taken"? */
function isDuplicateEmailError(message: string | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return (
    m.includes("already been registered") ||
    m.includes("already registered") ||
    m.includes("already exists") ||
    m.includes("duplicate key") ||
    m.includes("users_email_key") ||
    m.includes("email_exists")
  );
}

export async function addMemberToOrganization(
  authClient: SupabaseClient,
  input: AddMemberInput
): Promise<AddMemberResult> {
  const email = input.email.trim();
  const displayName = input.displayName.trim();
  const { targetRole, organizationId } = input;

  const fail = (error: string): AddMemberResult => ({ error, userId: null });

  // --- Input validation (before touching the DB / admin client) -------------
  if (!EMAIL_RE.test(email)) return fail("invalidEmail");
  // Reject empty (trimmed) and over-length (raw) — the DB caps the raw length.
  if (displayName.length === 0 || input.displayName.length > MAX_NAME_LEN) return fail("invalidName");
  // Malformed role/org are bad-request inputs (400), not server failures (500).
  if (targetRole !== "admin" && targetRole !== "member") return fail("invalidRequest");
  if (!organizationId) return fail("invalidRequest");

  // --- Authorization (RLS-scoped client) — the security boundary ------------
  const actingUser = await getCurrentUser(authClient);
  if (!actingUser) return fail("notAllowed");
  // Re-check the acting user's permission IN THE TARGET ORG. Runs as the current
  // user (RLS-scoped), so it also forbids cross-org creation.
  const allowed = await hasPermission(authClient, actingUser.id, organizationId, "members.manage");
  if (!allowed) return fail("notAllowed");

  // Resolve the org's canonical Admin / Member roles via the authenticated
  // client (RLS lets a member read their org's roles).
  const rolesRes = await authClient
    .from("roles")
    .select("id, name, is_admin")
    .eq("organization_id", organizationId);
  if (rolesRes.error) return fail("addFailed");
  const roles = (rolesRes.data ?? []) as Array<{ id: string; name: string; is_admin: boolean }>;
  const adminRole = roles.find((r) => r.is_admin);
  const memberRole =
    roles.find((r) => !r.is_admin && r.name === "Member") ?? roles.find((r) => !r.is_admin);
  const roleId = targetRole === "admin" ? adminRole?.id : memberRole?.id;
  if (!roleId) return fail("addFailed");

  // --- Privileged writes (secret key) — only after the check above passed ---
  const admin = createSupabaseAdminClient();
  if (!admin) return fail("notConfigured");

  // 1) Create the Supabase auth user. email_confirm so they can log in at once.
  const created = await admin.auth.admin.createUser({
    email,
    password: newUserPassword(),
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    if (isDuplicateEmailError(created.error?.message)) return fail("emailExists");
    captureException(created.error ?? new Error("createUser returned no user"), {
      action: "addMember",
      organizationId,
      actorId: actingUser.id,
      step: "createUser",
    });
    return fail("addFailed");
  }
  const authId = created.data.user.id;
  const normalizedEmail = created.data.user.email ?? email.toLowerCase();

  const rollback = async (): Promise<void> => {
    await admin.auth.admin.deleteUser(authId);
  };

  // 2) public.users profile row.
  const profile = await admin
    .from("users")
    .insert({ id: authId, email: normalizedEmail, display_name: displayName });
  if (profile.error) {
    await rollback();
    if (isDuplicateEmailError(profile.error.message)) return fail("emailExists");
    captureException(profile.error, { action: "addMember", organizationId, actorId: actingUser.id, step: "profile" });
    return fail("addFailed");
  }

  // 3) membership in the target org.
  const membershipRes = await admin
    .from("memberships")
    .insert({ user_id: authId, organization_id: organizationId })
    .select("id")
    .single();
  if (membershipRes.error || !membershipRes.data) {
    await rollback();
    captureException(membershipRes.error ?? new Error("membership insert returned no data"), {
      action: "addMember",
      organizationId,
      actorId: actingUser.id,
      step: "membership",
    });
    return fail("addFailed");
  }

  // 4) initial role on that membership.
  const mr = await admin.from("membership_roles").insert({
    membership_id: (membershipRes.data as { id: string }).id,
    role_id: roleId,
    organization_id: organizationId,
  });
  if (mr.error) {
    await rollback();
    captureException(mr.error, { action: "addMember", organizationId, actorId: actingUser.id, step: "membership_role" });
    return fail("addFailed");
  }

  logger.info("member added", {
    action: "addMember",
    organizationId,
    actorId: actingUser.id,
    newUserId: authId,
    role: targetRole,
  });
  return { error: null, userId: authId };
}
