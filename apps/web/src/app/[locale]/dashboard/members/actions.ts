"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getCurrentUser, hasPermission } from "@platform/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export interface RoleActionState {
  /** An i18n key under the "members" namespace, or null on success. */
  error: string | null;
}

/**
 * Change a member's role between Admin and Member.
 *
 * All reads/writes go through the AUTHENTICATED Supabase client (the session
 * cookie), so RLS is the enforcer: a user without `members.manage` in this org
 * is denied at the database (the INSERT raises an RLS error). We never use the
 * secret key here.
 */
export async function updateMemberRoleAction(
  _prev: RoleActionState,
  formData: FormData
): Promise<RoleActionState> {
  const membershipId = String(formData.get("membershipId") ?? "");
  const organizationId = String(formData.get("orgId") ?? "");
  const targetRole = String(formData.get("targetRole") ?? "");
  const locale = String(formData.get("locale") ?? "he");

  if (targetRole !== "admin" && targetRole !== "member") {
    return { error: "updateFailed" };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "notAllowed" };

  // Resolve this org's canonical Admin (is_admin) and Member roles. Reads run as
  // the current user; RLS lets org members read their org's roles.
  const rolesRes = await supabase
    .from("roles")
    .select("id, name, is_admin")
    .eq("organization_id", organizationId);
  if (rolesRes.error) return { error: "updateFailed" };
  const roles = (rolesRes.data ?? []) as Array<{ id: string; name: string; is_admin: boolean }>;
  const adminRole = roles.find((r) => r.is_admin);
  const memberRole =
    roles.find((r) => !r.is_admin && r.name === "Member") ?? roles.find((r) => !r.is_admin);
  if (!adminRole || !memberRole) return { error: "updateFailed" };

  // GUARD (enforced in the app for now — TODO: make this a DB-level guard, e.g.
  // a trigger, so it can't be bypassed by a direct API call): never demote the
  // organization's last admin.
  const adminRowsRes = await supabase
    .from("membership_roles")
    .select("membership_id")
    .eq("organization_id", organizationId)
    .eq("role_id", adminRole.id);
  if (adminRowsRes.error) return { error: "updateFailed" };
  const adminMembershipIds = (adminRowsRes.data ?? []).map((r) => r.membership_id as string);
  const targetIsCurrentlyAdmin = adminMembershipIds.includes(membershipId);
  if (targetRole === "member" && targetIsCurrentlyAdmin && adminMembershipIds.length <= 1) {
    return { error: "cannotRemoveLastAdmin" };
  }

  const addRoleId = targetRole === "admin" ? adminRole.id : memberRole.id;
  const removeRoleId = targetRole === "admin" ? memberRole.id : adminRole.id;

  // Ensure the target role is present (insert-ignore), then remove the other.
  // RLS gates both writes; a denied user gets an error on the INSERT.
  const upsert = await supabase
    .from("membership_roles")
    .upsert(
      { membership_id: membershipId, role_id: addRoleId, organization_id: organizationId },
      { onConflict: "membership_id,role_id", ignoreDuplicates: true }
    );
  if (upsert.error) return { error: "notAllowed" };

  const del = await supabase
    .from("membership_roles")
    .delete()
    .eq("membership_id", membershipId)
    .eq("role_id", removeRoleId)
    .eq("organization_id", organizationId);
  if (del.error) return { error: "notAllowed" };

  revalidatePath(`/${locale}/dashboard/members`);
  return { error: null };
}

export interface AddMemberState {
  /** An i18n key under the "members" namespace, or null on success. */
  error: string | null;
  /** True only after a member was successfully created. */
  success: boolean;
}

/**
 * Known DEV-ONLY temporary password so the demo can log in as a freshly created
 * user immediately (matches the seed). This is intentionally weak and is ONLY
 * ever used outside production — see `newUserPassword()`.
 *
 * PRODUCTION: never assign a known password (it would be a backdoor). A real
 * deployment must send a Supabase email invite / magic link, or force a reset
 * on first login. Until that flow exists, production falls back to a
 * cryptographically random password that is never returned or displayed.
 * Tracked as a pre-production TODO (see packages/db/SCHEMA.md, ARCHITECTURE.md
 * #16).
 */
const DEV_TEMP_PASSWORD = "123456";

/**
 * The password for a newly created user. In development we use the known dev
 * password so the demo flow allows an immediate login; in production we use a
 * random, never-disclosed password so the account can't be a backdoor (the user
 * would arrive via invite / reset once that flow is built).
 */
function newUserPassword(): string {
  if (process.env.NODE_ENV === "production") {
    return randomBytes(24).toString("base64url");
  }
  return DEV_TEMP_PASSWORD;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

/**
 * Add a brand-new user to an organization: create the Supabase auth user, the
 * public.users profile, the membership, and its initial role.
 *
 * SECURITY (see ARCHITECTURE.md #16):
 * - The privileged secret-key (service-role) client is built ONLY after we
 *   re-verify, server-side, that the ACTING user holds `members.manage` in the
 *   target org — using the AUTHENTICATED client (RLS-scoped). Hiding the UI
 *   button is UX; this check is the security boundary. We never trust the
 *   client's claim about who they are or what org they're acting on.
 * - That same permission check forbids cross-org creation: `hasPermission`
 *   returns false unless the acting user has a membership (with the permission)
 *   in `organizationId`, so an Org A admin cannot add users to Org B.
 * - The secret key is never imported by, or exposed to, the browser
 *   (see src/lib/supabase/admin.ts, which is `server-only`).
 *
 * Atomic-ish: the auth user is created first; if any later step fails we delete
 * it again (which cascades the profile / membership / role rows), so a failure
 * never leaves a half-provisioned user behind.
 */
export async function addMemberAction(
  _prev: AddMemberState,
  formData: FormData
): Promise<AddMemberState> {
  const email = String(formData.get("email") ?? "").trim();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const targetRole = String(formData.get("targetRole") ?? "");
  const organizationId = String(formData.get("orgId") ?? "");
  const locale = String(formData.get("locale") ?? "he");

  // --- Input validation ----------------------------------------------------
  if (!EMAIL_RE.test(email)) return { error: "invalidEmail", success: false };
  if (displayName.length === 0) return { error: "invalidName", success: false };
  if (targetRole !== "admin" && targetRole !== "member") {
    return { error: "addFailed", success: false };
  }
  if (!organizationId) return { error: "addFailed", success: false };

  // --- Authorization (server-side, NOT trusting the client) -----------------
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "notAllowed", success: false };

  const actingUser = await getCurrentUser(supabase);
  if (!actingUser) return { error: "notAllowed", success: false };

  // Re-check the acting user's permission IN THE TARGET ORG. Runs as the current
  // user (RLS-scoped), so it also guarantees no cross-org creation: a user
  // without a `members.manage` membership in this org is rejected here.
  const allowed = await hasPermission(
    supabase,
    actingUser.id,
    organizationId,
    "members.manage"
  );
  if (!allowed) return { error: "notAllowed", success: false };

  // Resolve the org's canonical Admin / Member roles via the authenticated
  // client (RLS lets a member read their org's roles).
  const rolesRes = await supabase
    .from("roles")
    .select("id, name, is_admin")
    .eq("organization_id", organizationId);
  if (rolesRes.error) return { error: "addFailed", success: false };
  const roles = (rolesRes.data ?? []) as Array<{ id: string; name: string; is_admin: boolean }>;
  const adminRole = roles.find((r) => r.is_admin);
  const memberRole =
    roles.find((r) => !r.is_admin && r.name === "Member") ?? roles.find((r) => !r.is_admin);
  const roleId = targetRole === "admin" ? adminRole?.id : memberRole?.id;
  if (!roleId) return { error: "addFailed", success: false };

  // --- Privileged writes (secret key) --------------------------------------
  // Only reached AFTER the permission check above succeeded.
  const admin = createSupabaseAdminClient();
  if (!admin) return { error: "notConfigured", success: false };

  // 1) Create the Supabase auth user. email_confirm so they can log in at once.
  const created = await admin.auth.admin.createUser({
    email,
    password: newUserPassword(),
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    if (isDuplicateEmailError(created.error?.message)) {
      return { error: "emailExists", success: false };
    }
    return { error: "addFailed", success: false };
  }
  const authId = created.data.user.id;
  // Supabase normalizes (lowercases) the email — keep the profile in sync.
  const normalizedEmail = created.data.user.email ?? email.toLowerCase();

  // Best-effort rollback: deleting the auth user cascades the profile,
  // membership, and membership_role rows (ON DELETE CASCADE).
  const rollback = async (): Promise<void> => {
    await admin.auth.admin.deleteUser(authId);
  };

  // 2) public.users profile row.
  const profile = await admin
    .from("users")
    .insert({ id: authId, email: normalizedEmail, display_name: displayName });
  if (profile.error) {
    await rollback();
    return {
      error: isDuplicateEmailError(profile.error.message) ? "emailExists" : "addFailed",
      success: false,
    };
  }

  // 3) membership in the target org.
  const membershipRes = await admin
    .from("memberships")
    .insert({ user_id: authId, organization_id: organizationId })
    .select("id")
    .single();
  if (membershipRes.error || !membershipRes.data) {
    await rollback();
    return { error: "addFailed", success: false };
  }

  // 4) initial role on that membership.
  const mr = await admin.from("membership_roles").insert({
    membership_id: (membershipRes.data as { id: string }).id,
    role_id: roleId,
    organization_id: organizationId,
  });
  if (mr.error) {
    await rollback();
    return { error: "addFailed", success: false };
  }

  revalidatePath(`/${locale}/dashboard/members`);
  return { error: null, success: true };
}
