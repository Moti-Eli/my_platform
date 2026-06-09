/**
 * @platform/auth
 *
 * Authentication + RBAC resolution, built on top of a Supabase client. This
 * package is intentionally UI-agnostic: every function takes a `SupabaseClient`
 * (created by the app via @platform/db), so it has no React/Next dependency and
 * can be reused by web and mobile alike.
 *
 * RBAC model (see packages/db/SCHEMA.md): a user's roles live on their
 * membership in an organization. Effective permissions = the union of
 * permissions across all roles on that membership; a role with `is_admin`
 * implies *all* permissions. Tenant isolation itself is enforced by RLS — these
 * helpers run as the current user, so they only ever see that user's data.
 */
import type { SupabaseClient, User } from "@supabase/supabase-js";

export const authVersion = "0.1.0";

export interface SignInResult {
  user: User | null;
  /** Null on success; otherwise the Supabase error message. */
  error: string | null;
}

export interface OrgRole {
  id: string;
  name: string;
  isAdmin: boolean;
}

export interface UserOrganization {
  organizationId: string;
  organizationName: string;
  roles: OrgRole[];
}

export interface OrgMember {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string | null;
  /** ISO timestamp of when the membership was created. */
  joinedAt: string;
  roles: OrgRole[];
}

/** Sign in with email + password. */
export async function signIn(
  supabase: SupabaseClient,
  email: string,
  password: string
): Promise<SignInResult> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { user: null, error: error.message };
  return { user: data.user, error: null };
}

/** Sign out the current user (clears the session). */
export async function signOut(supabase: SupabaseClient): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signOut();
  return { error: error ? error.message : null };
}

/** Get the currently authenticated user, or null if not signed in. */
export async function getCurrentUser(supabase: SupabaseClient): Promise<User | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
}

/**
 * Every organization the user belongs to, with their role(s) in each. Runs as
 * the current user, so RLS guarantees it only returns that user's memberships.
 */
export async function getUserOrganizations(
  supabase: SupabaseClient,
  userId: string
): Promise<UserOrganization[]> {
  const membershipsRes = await supabase
    .from("memberships")
    .select("id, organization_id")
    .eq("user_id", userId);
  if (membershipsRes.error) {
    throw new Error(`getUserOrganizations (memberships): ${membershipsRes.error.message}`);
  }
  const memberships = (membershipsRes.data ?? []) as Array<{
    id: string;
    organization_id: string;
  }>;
  if (memberships.length === 0) return [];

  const membershipIds = memberships.map((m) => m.id);
  const orgIds = memberships.map((m) => m.organization_id);

  const orgsRes = await supabase.from("organizations").select("id, name").in("id", orgIds);
  if (orgsRes.error) {
    throw new Error(`getUserOrganizations (organizations): ${orgsRes.error.message}`);
  }
  const orgs = (orgsRes.data ?? []) as Array<{ id: string; name: string }>;
  const orgNameById = new Map(orgs.map((o) => [o.id, o.name]));

  const mrRes = await supabase
    .from("membership_roles")
    .select("membership_id, role_id")
    .in("membership_id", membershipIds);
  if (mrRes.error) {
    throw new Error(`getUserOrganizations (membership_roles): ${mrRes.error.message}`);
  }
  const membershipRoles = (mrRes.data ?? []) as Array<{
    membership_id: string;
    role_id: string;
  }>;

  const roleById = new Map<string, OrgRole>();
  const roleIds = Array.from(new Set(membershipRoles.map((mr) => mr.role_id)));
  if (roleIds.length > 0) {
    const rolesRes = await supabase.from("roles").select("id, name, is_admin").in("id", roleIds);
    if (rolesRes.error) {
      throw new Error(`getUserOrganizations (roles): ${rolesRes.error.message}`);
    }
    const roles = (rolesRes.data ?? []) as Array<{ id: string; name: string; is_admin: boolean }>;
    for (const r of roles) {
      roleById.set(r.id, { id: r.id, name: r.name, isAdmin: Boolean(r.is_admin) });
    }
  }

  const rolesByMembership = new Map<string, OrgRole[]>();
  for (const mr of membershipRoles) {
    const role = roleById.get(mr.role_id);
    if (!role) continue;
    const list = rolesByMembership.get(mr.membership_id) ?? [];
    list.push(role);
    rolesByMembership.set(mr.membership_id, list);
  }

  return memberships.map((m) => ({
    organizationId: m.organization_id,
    organizationName: orgNameById.get(m.organization_id) ?? "(unknown)",
    roles: rolesByMembership.get(m.id) ?? [],
  }));
}

/**
 * All members of an organization, with their profile and role(s). Runs as the
 * current user — RLS guarantees this only returns data for orgs the user
 * belongs to, and only co-members' profiles (never the global user table).
 */
export async function getOrganizationMembers(
  supabase: SupabaseClient,
  organizationId: string
): Promise<OrgMember[]> {
  const membershipsRes = await supabase
    .from("memberships")
    .select("id, user_id, created_at")
    .eq("organization_id", organizationId);
  if (membershipsRes.error) {
    throw new Error(`getOrganizationMembers (memberships): ${membershipsRes.error.message}`);
  }
  const memberships = (membershipsRes.data ?? []) as Array<{
    id: string;
    user_id: string;
    created_at: string;
  }>;
  if (memberships.length === 0) return [];

  const userIds = memberships.map((m) => m.user_id);
  const membershipIds = memberships.map((m) => m.id);

  const usersRes = await supabase
    .from("users")
    .select("id, email, display_name")
    .in("id", userIds);
  if (usersRes.error) {
    throw new Error(`getOrganizationMembers (users): ${usersRes.error.message}`);
  }
  const users = (usersRes.data ?? []) as Array<{
    id: string;
    email: string;
    display_name: string | null;
  }>;
  const userById = new Map(users.map((u) => [u.id, u]));

  const mrRes = await supabase
    .from("membership_roles")
    .select("membership_id, role_id")
    .in("membership_id", membershipIds);
  if (mrRes.error) {
    throw new Error(`getOrganizationMembers (membership_roles): ${mrRes.error.message}`);
  }
  const membershipRoles = (mrRes.data ?? []) as Array<{ membership_id: string; role_id: string }>;

  const roleById = new Map<string, OrgRole>();
  const roleIds = Array.from(new Set(membershipRoles.map((mr) => mr.role_id)));
  if (roleIds.length > 0) {
    const rolesRes = await supabase.from("roles").select("id, name, is_admin").in("id", roleIds);
    if (rolesRes.error) {
      throw new Error(`getOrganizationMembers (roles): ${rolesRes.error.message}`);
    }
    const roles = (rolesRes.data ?? []) as Array<{ id: string; name: string; is_admin: boolean }>;
    for (const r of roles) {
      roleById.set(r.id, { id: r.id, name: r.name, isAdmin: Boolean(r.is_admin) });
    }
  }

  const rolesByMembership = new Map<string, OrgRole[]>();
  for (const mr of membershipRoles) {
    const role = roleById.get(mr.role_id);
    if (!role) continue;
    const list = rolesByMembership.get(mr.membership_id) ?? [];
    list.push(role);
    rolesByMembership.set(mr.membership_id, list);
  }

  return memberships
    .map((m) => {
      const profile = userById.get(m.user_id);
      return {
        membershipId: m.id,
        userId: m.user_id,
        email: profile?.email ?? "",
        displayName: profile?.display_name ?? null,
        joinedAt: m.created_at,
        roles: rolesByMembership.get(m.id) ?? [],
      };
    })
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
}

/** Every permission key the user effectively has in the given organization. */
export async function getEffectivePermissions(
  supabase: SupabaseClient,
  userId: string,
  organizationId: string
): Promise<string[]> {
  const membershipRes = await supabase
    .from("memberships")
    .select("id")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (membershipRes.error) {
    throw new Error(`getEffectivePermissions (membership): ${membershipRes.error.message}`);
  }
  const membership = membershipRes.data as { id: string } | null;
  if (!membership) return [];

  const mrRes = await supabase
    .from("membership_roles")
    .select("role_id")
    .eq("membership_id", membership.id);
  if (mrRes.error) {
    throw new Error(`getEffectivePermissions (membership_roles): ${mrRes.error.message}`);
  }
  const roleIds = ((mrRes.data ?? []) as Array<{ role_id: string }>).map((r) => r.role_id);
  if (roleIds.length === 0) return [];

  const rolesRes = await supabase.from("roles").select("id, is_admin").in("id", roleIds);
  if (rolesRes.error) {
    throw new Error(`getEffectivePermissions (roles): ${rolesRes.error.message}`);
  }
  const roles = (rolesRes.data ?? []) as Array<{ id: string; is_admin: boolean }>;
  // An admin role implies every permission.
  if (roles.some((r) => Boolean(r.is_admin))) {
    return getAllPermissionKeys(supabase);
  }

  const rpRes = await supabase
    .from("role_permissions")
    .select("permission_id")
    .in("role_id", roleIds);
  if (rpRes.error) {
    throw new Error(`getEffectivePermissions (role_permissions): ${rpRes.error.message}`);
  }
  const permissionIds = Array.from(
    new Set(((rpRes.data ?? []) as Array<{ permission_id: string }>).map((rp) => rp.permission_id))
  );
  if (permissionIds.length === 0) return [];

  const permsRes = await supabase.from("permissions").select("key").in("id", permissionIds);
  if (permsRes.error) {
    throw new Error(`getEffectivePermissions (permissions): ${permsRes.error.message}`);
  }
  return Array.from(new Set(((permsRes.data ?? []) as Array<{ key: string }>).map((p) => p.key)));
}

/** Whether the user has a specific permission in the given organization. */
export async function hasPermission(
  supabase: SupabaseClient,
  userId: string,
  organizationId: string,
  permissionKey: string
): Promise<boolean> {
  const permissions = await getEffectivePermissions(supabase, userId, organizationId);
  return permissions.includes(permissionKey);
}

async function getAllPermissionKeys(supabase: SupabaseClient): Promise<string[]> {
  const res = await supabase.from("permissions").select("key");
  if (res.error) throw new Error(`getAllPermissionKeys: ${res.error.message}`);
  return ((res.data ?? []) as Array<{ key: string }>).map((p) => p.key);
}

// ===========================================================================
// Platform owner (super admin) — the access level ABOVE organization admins.
// ===========================================================================
// A platform owner operates the whole platform (e.g. onboards new client orgs).
// Owner status lives in the sealed `platform_admins` table and is checked via
// the `auth_user_is_platform_owner()` RPC (a SECURITY DEFINER boolean self-check
// — see migration 20260609000001). Per ARCHITECTURE.md, super-admin power is
// SERVER-SIDE ONLY: there are NO cross-org RLS policies, so an owner gains no
// special powers through their normal (publishable-key) session. The privileged
// writes below therefore require a separate service-role client.
// ===========================================================================

/**
 * Whether the currently authenticated user is a platform owner.
 *
 * Runs as that user (their session) and calls the `auth_user_is_platform_owner`
 * RPC, which only ever reports on the caller — it never exposes the owner list.
 * Returns false on any error (fail closed).
 */
export async function isPlatformOwner(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("auth_user_is_platform_owner");
  if (error) return false;
  return data === true;
}

export interface CreateOrganizationInput {
  organizationName: string;
  adminEmail: string;
  adminDisplayName: string;
  /**
   * Password for the first admin's auth account. The CALLER decides this (e.g.
   * a known dev temp password vs. a random, never-disclosed one), mirroring the
   * add-member pattern — this package never hard-codes a credential.
   */
  adminPassword: string;
}

export interface CreateOrganizationResult {
  /** Null on success; otherwise a short error key. */
  error: string | null;
  organizationId: string | null;
  adminUserId: string | null;
}

/** Permissions granted to a new org's non-admin "Member" role (matches the seed). */
const NEW_ORG_MEMBER_PERMISSIONS = ["users.view", "users.invite"];

const ORG_ADMIN_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Heuristic: does this Supabase error mean "that email is already taken"? */
function isDuplicateEmail(message: string | undefined): boolean {
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
 * Create a brand-new organization and its first admin — the platform-owner
 * onboarding action. SERVER-SIDE ONLY.
 *
 * SECURITY (see ARCHITECTURE.md "Platform-Owner layer"):
 * - `actingClient` must be authenticated as the acting user. We re-verify
 *   server-side that they are a platform owner (via the RPC) BEFORE touching the
 *   privileged client. Never trust the caller's claim.
 * - `serviceClient` uses the secret/service-role key (bypasses RLS) and must
 *   only ever exist server-side. It is used solely for the provisioning writes,
 *   and only after the owner check passes.
 *
 * Atomic-ish with rollback (mirrors add-member, extended to also create the
 * org): on any failure we delete whatever we created — the auth user (which
 * cascades its profile/membership/role) and the organization (which cascades its
 * roles/memberships) — so a failure never leaves a half-provisioned tenant.
 *
 * Creates: organization + Admin role (is_admin) + Member role (+ baseline
 * permissions) + first admin (auth user + profile + membership + Admin role).
 */
export async function createOrganizationWithFirstAdmin(
  actingClient: SupabaseClient,
  serviceClient: SupabaseClient,
  input: CreateOrganizationInput
): Promise<CreateOrganizationResult> {
  const organizationName = input.organizationName.trim();
  const adminEmail = input.adminEmail.trim();
  const adminDisplayName = input.adminDisplayName.trim();

  const fail = (error: string): CreateOrganizationResult => ({
    error,
    organizationId: null,
    adminUserId: null,
  });

  // --- Authorization: must be a platform owner (re-checked server-side) ------
  if (!(await isPlatformOwner(actingClient))) return fail("notAllowed");

  // --- Input validation ------------------------------------------------------
  if (organizationName.length === 0) return fail("invalidOrgName");
  if (!ORG_ADMIN_EMAIL_RE.test(adminEmail)) return fail("invalidEmail");
  if (adminDisplayName.length === 0) return fail("invalidName");
  if (input.adminPassword.length < 6) return fail("invalidPassword");

  // --- Privileged provisioning (service role) --------------------------------
  // Track what we created so we can roll back on any later failure.
  let createdOrgId: string | null = null;
  let createdAuthId: string | null = null;

  const rollback = async (): Promise<void> => {
    // Deleting the auth user cascades its profile/membership/role; deleting the
    // org cascades its roles/memberships. Best-effort; ignore secondary errors.
    if (createdAuthId) await serviceClient.auth.admin.deleteUser(createdAuthId);
    if (createdOrgId) await serviceClient.from("organizations").delete().eq("id", createdOrgId);
  };

  // 1) Organization.
  const orgRes = await serviceClient
    .from("organizations")
    .insert({ name: organizationName })
    .select("id")
    .single();
  if (orgRes.error || !orgRes.data) return fail("createFailed");
  createdOrgId = (orgRes.data as { id: string }).id;

  // 2) Admin + Member roles.
  const adminRoleRes = await serviceClient
    .from("roles")
    .insert({ organization_id: createdOrgId, name: "Admin", is_admin: true })
    .select("id")
    .single();
  if (adminRoleRes.error || !adminRoleRes.data) {
    await rollback();
    return fail("createFailed");
  }
  const adminRoleId = (adminRoleRes.data as { id: string }).id;

  const memberRoleRes = await serviceClient
    .from("roles")
    .insert({ organization_id: createdOrgId, name: "Member", is_admin: false })
    .select("id")
    .single();
  if (memberRoleRes.error || !memberRoleRes.data) {
    await rollback();
    return fail("createFailed");
  }
  const memberRoleId = (memberRoleRes.data as { id: string }).id;

  // 2b) Grant the Member role its baseline permissions (parity with the seed).
  const permsRes = await serviceClient
    .from("permissions")
    .select("id, key")
    .in("key", NEW_ORG_MEMBER_PERMISSIONS);
  if (permsRes.error) {
    await rollback();
    return fail("createFailed");
  }
  const rolePermRows = ((permsRes.data ?? []) as Array<{ id: string; key: string }>).map((p) => ({
    role_id: memberRoleId,
    permission_id: p.id,
  }));
  if (rolePermRows.length > 0) {
    const rpRes = await serviceClient.from("role_permissions").insert(rolePermRows);
    if (rpRes.error) {
      await rollback();
      return fail("createFailed");
    }
  }

  // 3) First admin's auth user.
  const created = await serviceClient.auth.admin.createUser({
    email: adminEmail,
    password: input.adminPassword,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    await rollback();
    return fail(isDuplicateEmail(created.error?.message) ? "emailExists" : "createFailed");
  }
  createdAuthId = created.data.user.id;
  const normalizedEmail = created.data.user.email ?? adminEmail.toLowerCase();

  // 4) Profile row.
  const profileRes = await serviceClient
    .from("users")
    .insert({ id: createdAuthId, email: normalizedEmail, display_name: adminDisplayName });
  if (profileRes.error) {
    await rollback();
    return fail(isDuplicateEmail(profileRes.error.message) ? "emailExists" : "createFailed");
  }

  // 5) Membership in the new org.
  const membershipRes = await serviceClient
    .from("memberships")
    .insert({ user_id: createdAuthId, organization_id: createdOrgId })
    .select("id")
    .single();
  if (membershipRes.error || !membershipRes.data) {
    await rollback();
    return fail("createFailed");
  }

  // 6) Assign the Admin role to that membership.
  const mrRes = await serviceClient.from("membership_roles").insert({
    membership_id: (membershipRes.data as { id: string }).id,
    role_id: adminRoleId,
    organization_id: createdOrgId,
  });
  if (mrRes.error) {
    await rollback();
    return fail("createFailed");
  }

  return { error: null, organizationId: createdOrgId, adminUserId: createdAuthId };
}
