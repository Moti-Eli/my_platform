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

/**
 * List every permission key defined on the platform. The `permissions` table is
 * publicly readable (no tenant data), so this also doubles as a lightweight
 * connectivity/health check for clients — e.g. the mobile app's startup probe.
 */
export async function getAllPermissionKeys(supabase: SupabaseClient): Promise<string[]> {
  const res = await supabase.from("permissions").select("key");
  if (res.error) throw new Error(`getAllPermissionKeys: ${res.error.message}`);
  return ((res.data ?? []) as Array<{ key: string }>).map((p) => p.key);
}

/**
 * The permission keys defined in the platform catalog (seeded in migration
 * `20260605000001_core_rbac_schema`). This is a compile-time mirror of those
 * rows: adding a permission means seeding it via migration AND adding its key
 * here. Used to type feature gates (see `@platform/core` `FEATURES`) and any
 * `hasPermission` call sites that want key safety. Runtime checks still take a
 * plain `string`, so this is purely additive and changes no behavior.
 */
export type PermissionKey = "members.manage";

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
// EMPTY, and deliberately so — not a list waiting to be refilled. Both former
// entries were granted-but-never-checked and were deleted: `users.invite`
// (migration 20260610000003) and `users.view` (20260717000003). A plain member's
// baseline is MEMBERSHIP itself, which is what RLS keys on; permissions are for
// ACTIONS beyond that baseline, and a plain member has none. The lookup below is
// kept as the seam for when a real member-level action exists.
const NEW_ORG_MEMBER_PERMISSIONS: PermissionKey[] = [];

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
export interface SignUpInput {
  email: string;
  password: string;
  displayName: string;
  organizationName: string;
}

export interface SignUpResult {
  /** Null on success; otherwise a short error key. */
  error: string | null;
  userId: string | null;
  organizationId: string | null;
}

/**
 * Self-service signup: create a brand-new organization and register its owner
 * as the first admin. SERVER-SIDE ONLY.
 *
 * This is the public-registration counterpart to
 * `createOrganizationWithFirstAdmin`, with one deliberate difference: there is
 * NO acting user and NO authorization gate. A self-registering user is not a
 * platform owner and there is nothing to check — this call is what *creates*
 * their identity, so no identity exists to authorize yet. The only client is the
 * `serviceClient` (service-role key, bypasses RLS). It is required because
 * `organizations`/`memberships` have SELECT-only RLS for `authenticated` and no
 * INSERT policy, so provisioning cannot run under a normal user session.
 *
 * Everything else mirrors `createOrganizationWithFirstAdmin`: org + Admin role
 * (is_admin) + Member role (+ baseline permissions) + auth user + profile +
 * membership + Admin role on that membership, with full rollback on any failure
 * so a failed signup never leaves a half-provisioned tenant. The new user gets
 * the org's Admin role — they own the org they just created.
 */
export async function signUpWithNewOrganization(
  serviceClient: SupabaseClient,
  input: SignUpInput
): Promise<SignUpResult> {
  const organizationName = input.organizationName.trim();
  const email = input.email.trim();
  const displayName = input.displayName.trim();

  const fail = (error: string): SignUpResult => ({
    error,
    userId: null,
    organizationId: null,
  });

  // --- Input validation ------------------------------------------------------
  // No authorization gate: identity does not exist yet — this call creates it.
  if (organizationName.length === 0) return fail("invalidOrgName");
  if (!ORG_ADMIN_EMAIL_RE.test(email)) return fail("invalidEmail");
  if (displayName.length === 0) return fail("invalidName");
  if (input.password.length < 6) return fail("invalidPassword");

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

  // 3) Owner's auth user.
  const created = await serviceClient.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    await rollback();
    return fail(isDuplicateEmail(created.error?.message) ? "emailExists" : "createFailed");
  }
  createdAuthId = created.data.user.id;
  const normalizedEmail = created.data.user.email ?? email.toLowerCase();

  // 4) Profile row.
  const profileRes = await serviceClient
    .from("users")
    .insert({ id: createdAuthId, email: normalizedEmail, display_name: displayName });
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

  // 6) Assign the Admin role to that membership (the signup user owns their org).
  const mrRes = await serviceClient.from("membership_roles").insert({
    membership_id: (membershipRes.data as { id: string }).id,
    role_id: adminRoleId,
    organization_id: createdOrgId,
  });
  if (mrRes.error) {
    await rollback();
    return fail("createFailed");
  }

  return { error: null, userId: createdAuthId, organizationId: createdOrgId };
}

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

export interface AddMemberInput {
  email: string;
  displayName: string;
  organizationId: string;
  /**
   * Password for the new user's auth account. The CALLER decides it (dev temp vs.
   * random, never-disclosed), mirroring createOrganizationWithFirstAdmin — this
   * package never hard-codes a credential.
   */
  password: string;
}

export interface AddMemberResult {
  /** Null on success; otherwise a short error key. */
  error: string | null;
  /** The new user's id on success; null otherwise. */
  userId: string | null;
}

/** DB CHECK caps display names at 200 raw chars (see SCHEMA.md). Reject before the DB. */
const MAX_MEMBER_NAME_LEN = 200;

/**
 * Add a NEW auth user to an EXISTING organization as a plain member. SERVER-SIDE
 * ONLY. The org and its Admin/Member roles already exist (self-signup created
 * them); this only provisions the user and joins them.
 *
 * MEMBER-ONLY, deliberately: this always assigns the org's Member (non-admin)
 * role. There is no `targetRole` parameter — promotion to admin already exists
 * via the `set_member_role` RPC, so "add" stays simple.
 *
 * SECURITY — the two clients are NOT interchangeable, and which write goes on
 * which is the whole correctness of this function:
 * - `actingClient` must be authenticated as the acting user (their JWT). We
 *   re-check `members.manage` IN THE TARGET ORG on it FIRST — the security
 *   boundary, which also enforces tenant isolation (an Org A admin has no
 *   members.manage in Org B, so `hasPermission` is false there).
 * - `serviceClient` (secret/service-role key, bypasses RLS) does the user +
 *   profile + membership writes, which have no INSERT policy for `authenticated`.
 * - The ROLE assignment goes back through `actingClient`, NOT the service client:
 *   membership_roles has a `members.manage` INSERT policy AND a no-escalation
 *   trigger (20260717000003) that fires for service_role too and reads
 *   auth.uid(); a no-JWT service caller has auth.uid()=null and is rejected. The
 *   write must carry the actor's identity so the DB re-decides it per-row against
 *   the real actor.
 *
 * Atomic-ish with rollback: the auth user is created first; any later failure
 * deletes it again (FK ON DELETE CASCADE removes profile/membership/role).
 */
export async function addMemberToOrg(
  actingClient: SupabaseClient,
  serviceClient: SupabaseClient,
  input: { email: string; displayName: string; organizationId: string; password: string }
): Promise<AddMemberResult> {
  const email = input.email.trim();
  const displayName = input.displayName.trim();
  const { organizationId } = input;

  const fail = (error: string): AddMemberResult => ({ error, userId: null });

  // --- Input validation (before touching the DB / admin client) -------------
  if (!ORG_ADMIN_EMAIL_RE.test(email)) return fail("invalidEmail");
  // Reject empty (trimmed) and over-length (raw) — the DB caps the raw length.
  if (displayName.length === 0 || input.displayName.length > MAX_MEMBER_NAME_LEN) {
    return fail("invalidName");
  }
  if (!organizationId) return fail("invalidRequest");

  // --- Authorization (acting client, RLS-scoped) — the security boundary -----
  const actingUser = await getCurrentUser(actingClient);
  if (!actingUser) return fail("notAllowed");
  // Re-check the acting user's permission IN THE TARGET ORG. Runs as that user,
  // so it also forbids cross-org creation.
  const allowed = await hasPermission(
    actingClient,
    actingUser.id,
    organizationId,
    "members.manage"
  );
  if (!allowed) return fail("notAllowed");

  // Resolve the org's Member role via the acting client (RLS lets a member read
  // their org's roles). Prefer the canonical "Member", else any non-admin role.
  const rolesRes = await actingClient
    .from("roles")
    .select("id, name, is_admin")
    .eq("organization_id", organizationId);
  if (rolesRes.error) return fail("addFailed");
  const roles = (rolesRes.data ?? []) as Array<{ id: string; name: string; is_admin: boolean }>;
  const memberRole =
    roles.find((r) => !r.is_admin && r.name === "Member") ?? roles.find((r) => !r.is_admin);
  const memberRoleId = memberRole?.id;
  if (!memberRoleId) return fail("addFailed");

  // --- Existing-identity branch: LINK rather than create --------------------
  // If an identity with this email already exists, we do NOT create a user and do
  // NOT touch their profile — we only JOIN them to this org as a member. The
  // lookup is via the SERVICE client because the acting client can't read a
  // non-co-member's user row (RLS). Only the membership+role writes follow, each
  // on the same client the new-user tail uses.
  const existing = await serviceClient
    .from("users")
    .select("id")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  if (existing.error) return fail("addFailed");
  if (existing.data) {
    const existingUserId = (existing.data as { id: string }).id;

    // Membership via SERVICE (memberships has no INSERT policy for authenticated).
    const membershipRes = await serviceClient
      .from("memberships")
      .insert({ user_id: existingUserId, organization_id: organizationId })
      .select("id")
      .single();
    if (membershipRes.error || !membershipRes.data) {
      // The DB enforces UNIQUE (user_id, organization_id) = memberships_user_org_unique.
      // A duplicate is the "already a member" outcome, distinct from a real fault.
      const e = membershipRes.error;
      const isDup =
        e?.code === "23505" ||
        /duplicate key|memberships_user_org_unique/i.test(e?.message ?? "");
      return fail(isDup ? "alreadyMember" : "addFailed");
    }
    const newMembershipId = (membershipRes.data as { id: string }).id;

    // Role via the ACTING client — same escalation-guarded path as the new-user
    // tail: the DB re-decides it per-row against the real actor's auth.uid().
    const mrRes = await actingClient.from("membership_roles").insert({
      membership_id: newMembershipId,
      role_id: memberRoleId,
      organization_id: organizationId,
    });
    if (mrRes.error) {
      // ISOLATED ROLLBACK: delete ONLY the membership we just made — NEVER the
      // user. The identity pre-existed this call; we must not remove it.
      await serviceClient.from("memberships").delete().eq("id", newMembershipId);
      return fail(/Not allowed to assign the role/.test(mrRes.error.message) ? "notAllowed" : "addFailed");
    }

    return { error: null, userId: existingUserId };
  }

  // --- Privileged writes (service role) — only after the check above passed --
  // 1) Create the Supabase auth user. email_confirm so they can log in at once.
  const created = await serviceClient.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    return fail(isDuplicateEmail(created.error?.message) ? "emailExists" : "addFailed");
  }
  const authId = created.data.user.id;
  const normalizedEmail = created.data.user.email ?? email.toLowerCase();

  const rollback = async (): Promise<void> => {
    // Deleting the auth user cascades its profile/membership/role. Best-effort.
    await serviceClient.auth.admin.deleteUser(authId);
  };

  // 2) public.users profile row.
  const profileRes = await serviceClient
    .from("users")
    .insert({ id: authId, email: normalizedEmail, display_name: displayName });
  if (profileRes.error) {
    await rollback();
    return fail(isDuplicateEmail(profileRes.error.message) ? "emailExists" : "addFailed");
  }

  // 3) Membership in the target org.
  const membershipRes = await serviceClient
    .from("memberships")
    .insert({ user_id: authId, organization_id: organizationId })
    .select("id")
    .single();
  if (membershipRes.error || !membershipRes.data) {
    await rollback();
    return fail("addFailed");
  }

  // 4) Member role on that membership — assigned AS THE ACTING USER, not with the
  //    service key. The escalation guard (20260717000003) fires for service_role
  //    too and a no-JWT caller has auth.uid()=null, so this write MUST carry the
  //    actor's identity; the DB re-decides it per-row against the real actor.
  const mrRes = await actingClient.from("membership_roles").insert({
    membership_id: (membershipRes.data as { id: string }).id,
    role_id: memberRoleId,
    organization_id: organizationId,
  });
  if (mrRes.error) {
    await rollback();
    // The actor may not confer this role. That is a permission answer, not a fault.
    return fail(/Not allowed to assign the role/.test(mrRes.error.message) ? "notAllowed" : "addFailed");
  }

  return { error: null, userId: authId };
}

export interface CreateChildOrgWithMemberInput {
  organizationName: string;
  parentOrganizationId: string;
  email: string;
  displayName: string;
  /**
   * Password for the new member's auth account. The CALLER decides it (dev temp
   * vs. random, never-disclosed), mirroring the other provisioning functions —
   * this package never hard-codes a credential.
   */
  password: string;
}

export interface CreateChildOrgWithMemberResult {
  /** Null on success; otherwise a short error key. */
  error: string | null;
  /** The new CHILD organization's id on success; null otherwise. */
  organizationId: string | null;
  /** The new member's user id on success; null otherwise. */
  userId: string | null;
}

/**
 * Provision an isolated CHILD organization under an existing org and join a new
 * user to it. SERVER-SIDE ONLY.
 *
 * WHY THE GATE IS ON THE PARENT ORG: the child does not exist yet, so there is
 * nothing to authorize against there — the act being authorized is "create a
 * branch beneath THIS org", so the actor must hold `members.manage` IN THE
 * PARENT. Checked on `actingClient` (their JWT) exactly like addMemberToOrg,
 * which also enforces tenant isolation: an admin of Org A holds no
 * members.manage in Org B, so they cannot grow branches under someone else's
 * tree.
 *
 * WHAT THE ISOLATION BUYS — DOWNWARD-ONLY reads: org-tree membership
 * (auth_user_is_member_of_tree) means "member of the org or of an ANCESTOR", so
 * members of the parent can read the child's data, while the child's members
 * CANNOT read the parent and sibling branches CANNOT read each other. A child
 * org is the unit of isolation for a branch/team that the parent still oversees.
 *
 * TWO CLIENTS, NOT INTERCHANGEABLE (same split as addMemberToOrg):
 * - `actingClient` carries the actor's JWT: the authorization gate above, and
 *   the FINAL role assignment (step 8 below).
 * - `serviceClient` (secret/service-role key, bypasses RLS) does the
 *   provisioning writes (org/roles/user/profile/memberships), which have no
 *   INSERT policy for `authenticated`.
 *
 * BOOTSTRAP EXEMPTION DEPENDENCY: the acting user's OWN Admin-role assignment
 * in the brand-new child goes through the service client and relies on the
 * bootstrap exemption in 20260717000003 — the escalation trigger waves through
 * the first assignment in an org with ZERO membership_roles rows, because a
 * just-provisioned org has no admin yet who could authorize one. That door is
 * one-shot per org BY CONSTRUCTION: the exempted insert itself gives the org
 * its first membership_roles row, closing the exemption behind it.
 *
 * WHY STEP 8 USES THE ACTING CLIENT: once the actor holds the child's is_admin
 * role, the NEW member's Member-role assignment must carry the actor's JWT, not
 * service_role — membership_roles has a `members.manage` INSERT policy AND the
 * no-escalation trigger fires for service_role too and reads auth.uid(); a
 * no-JWT service caller has auth.uid()=null and is rejected. The write goes
 * through `actingClient` so the DB re-decides it per-row against the real actor.
 *
 * Atomic-ish with rollback (mirrors signUpWithNewOrganization verbatim): on any
 * failure we delete whatever we created — the auth user (which cascades its
 * profile/membership/role) and the child org (which cascades its
 * roles/memberships, including the actor's) — so a failure never leaves a
 * half-provisioned branch.
 */
export async function createChildOrgWithMember(
  actingClient: SupabaseClient,
  serviceClient: SupabaseClient,
  input: CreateChildOrgWithMemberInput
): Promise<CreateChildOrgWithMemberResult> {
  const organizationName = input.organizationName.trim();
  const email = input.email.trim();
  const displayName = input.displayName.trim();
  const { parentOrganizationId } = input;

  const fail = (error: string): CreateChildOrgWithMemberResult => ({
    error,
    organizationId: null,
    userId: null,
  });

  // --- Input validation (before touching the DB / admin client) -------------
  if (organizationName.length === 0) return fail("invalidOrgName");
  if (!ORG_ADMIN_EMAIL_RE.test(email)) return fail("invalidEmail");
  // Reject empty (trimmed) and over-length (raw) — the DB caps the raw length.
  if (displayName.length === 0 || input.displayName.length > MAX_MEMBER_NAME_LEN) {
    return fail("invalidName");
  }
  if (input.password.length < 6) return fail("invalidPassword");
  if (!parentOrganizationId) return fail("invalidRequest");

  // --- Authorization (acting client, RLS-scoped) — the security boundary -----
  // The gate is on the PARENT org: creating a child beneath it is a parent-org
  // management act. Runs as the actor, so it also forbids cross-org creation.
  const actingUser = await getCurrentUser(actingClient);
  if (!actingUser) return fail("notAllowed");
  const allowed = await hasPermission(
    actingClient,
    actingUser.id,
    parentOrganizationId,
    "members.manage"
  );
  if (!allowed) return fail("notAllowed");

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

  // 1) The CHILD organization — parent_id is what hangs it under the tree.
  const orgRes = await serviceClient
    .from("organizations")
    .insert({ name: organizationName, parent_id: parentOrganizationId })
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

  // 3) The ACTING user's membership in the child — the parent admin runs the
  //    branch they just created.
  const actorMembershipRes = await serviceClient
    .from("memberships")
    .insert({ user_id: actingUser.id, organization_id: createdOrgId })
    .select("id")
    .single();
  if (actorMembershipRes.error || !actorMembershipRes.data) {
    await rollback();
    return fail("createFailed");
  }

  // 3b) Assign the actor the child's Admin role. This service-client insert
  //     relies on the BOOTSTRAP EXEMPTION in 20260717000003: the escalation
  //     trigger waves through the first assignment in an org with ZERO
  //     membership_roles rows (a just-provisioned org has no admin yet who could
  //     authorize one). One-shot per org BY CONSTRUCTION — this very row closes
  //     the exemption behind it.
  const actorRoleRes = await serviceClient.from("membership_roles").insert({
    membership_id: (actorMembershipRes.data as { id: string }).id,
    role_id: adminRoleId,
    organization_id: createdOrgId,
  });
  if (actorRoleRes.error) {
    await rollback();
    return fail("createFailed");
  }

  // 4) The new member's auth user. email_confirm so they can log in at once.
  const created = await serviceClient.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    await rollback();
    return fail(isDuplicateEmail(created.error?.message) ? "emailExists" : "createFailed");
  }
  createdAuthId = created.data.user.id;
  const normalizedEmail = created.data.user.email ?? email.toLowerCase();

  // 5) Profile row.
  const profileRes = await serviceClient
    .from("users")
    .insert({ id: createdAuthId, email: normalizedEmail, display_name: displayName });
  if (profileRes.error) {
    await rollback();
    return fail(isDuplicateEmail(profileRes.error.message) ? "emailExists" : "createFailed");
  }

  // 6) Membership in the child org.
  const membershipRes = await serviceClient
    .from("memberships")
    .insert({ user_id: createdAuthId, organization_id: createdOrgId })
    .select("id")
    .single();
  if (membershipRes.error || !membershipRes.data) {
    await rollback();
    return fail("createFailed");
  }

  // 7) Member role on that membership — assigned AS THE ACTING USER, not with
  //    the service key. By now the actor holds the child's is_admin role (3b),
  //    so both the members.manage INSERT policy and the auth_user_may_assign_role
  //    trigger pass FOR THE REAL ACTOR. It must carry their JWT rather than go
  //    through service_role: the escalation guard (20260717000003) fires for
  //    service_role too and reads auth.uid() — a no-JWT service caller has
  //    auth.uid()=null and is rejected. The DB re-decides the write per-row
  //    against the real actor.
  const mrRes = await actingClient.from("membership_roles").insert({
    membership_id: (membershipRes.data as { id: string }).id,
    role_id: memberRoleId,
    organization_id: createdOrgId,
  });
  if (mrRes.error) {
    await rollback();
    // The actor may not confer this role. That is a permission answer, not a fault.
    return fail(
      /Not allowed to assign the role/.test(mrRes.error.message) ? "notAllowed" : "createFailed"
    );
  }

  return { error: null, organizationId: createdOrgId, userId: createdAuthId };
}

export interface CreateOrganizationForCurrentUserInput {
  organizationName: string;
}

export interface CreateOrganizationForCurrentUserResult {
  /** Null on success; otherwise a short error key. */
  error: string | null;
  /** The new ROOT organization's id on success; null otherwise. */
  organizationId: string | null;
}

/**
 * Create a brand-new ROOT organization for the ALREADY-LOGGED-IN user and make
 * them its first admin. SERVER-SIDE ONLY.
 *
 * WHY THE GATE IS ONLY "LOGGED IN": unlike createChildOrgWithMember, there is no
 * parent org to authorize against — this is a ROOT org the user creates FOR
 * THEMSELVES, so having a session IS the whole authorization. There is
 * deliberately no `members.manage` (or any other) permission check: a user
 * spinning up their own top-level org answers to no existing org, so there is
 * nothing to check it against. The absence is intentional, not an oversight
 * (see the explicit comment on the gate below).
 *
 * ROOT ORG — NO TREE INHERITANCE EITHER DIRECTION: the org is inserted with NO
 * `parent_id`, so it hangs off nothing. auth_user_is_member_of_tree (ancestor
 * walk) therefore never reaches it from anyone else and never reaches anyone
 * else from it: no one inherits reads into this org, and its members inherit
 * reads out of it to no one. It is its own isolated root.
 *
 * BOOTSTRAP EXEMPTION DEPENDENCY: the user's OWN Admin-role assignment in the
 * brand-new org goes through the service client and relies on the bootstrap
 * exemption in 20260717000003 — the escalation trigger waves through the first
 * assignment in an org with ZERO membership_roles rows, because a just-created
 * org has no admin yet who could authorize one. That door is one-shot per org
 * BY CONSTRUCTION: the exempted insert itself gives the org its first
 * membership_roles row, closing the exemption behind it.
 *
 * NO organizations RLS CHANGE IS NEEDED: the organizations SELECT policy is
 * auth_user_is_member_of(id), so the new membership ALONE makes the org visible
 * to the user (e.g. in the org switcher) — there is nothing to grant on the org
 * itself beyond joining them to it.
 *
 * TWO CLIENTS (same split as the sibling provisioning functions):
 * - `actingClient` carries the actor's JWT: used solely for the "logged in"
 *   gate below.
 * - `serviceClient` (secret/service-role key, bypasses RLS) does the
 *   provisioning writes (org/roles/membership/membership_roles), which have no
 *   INSERT policy for `authenticated`.
 *
 * Atomic-ish with rollback: on any failure we delete the org, which cascades its
 * roles/memberships — so a failure never leaves a half-provisioned tenant. NO
 * auth user is created here (the user already exists), so the rollback is
 * ORG-ONLY, unlike the sibling functions that also delete a created auth user.
 */
export async function createOrganizationForCurrentUser(
  actingClient: SupabaseClient,
  serviceClient: SupabaseClient,
  input: CreateOrganizationForCurrentUserInput
): Promise<CreateOrganizationForCurrentUserResult> {
  const organizationName = input.organizationName.trim();

  const fail = (error: string): CreateOrganizationForCurrentUserResult => ({
    error,
    organizationId: null,
  });

  // --- Input validation ------------------------------------------------------
  if (organizationName.length === 0) return fail("invalidOrgName");

  // --- Authorization (acting client, RLS-scoped) — the security boundary -----
  // THE GATE IS ONLY "LOGGED IN", BY DESIGN. This is a ROOT org the user creates
  // for themselves: there is no parent org, so there is no members.manage (or
  // any other) permission to check against. The missing permission check is
  // DELIBERATE, not forgotten — being authenticated is the whole authorization.
  const actingUser = await getCurrentUser(actingClient);
  if (!actingUser) return fail("notAllowed");

  // --- Per-user duplicate-name guard (acting client, RLS-scoped) -------------
  // Reuse getUserOrganizations — the SAME memberships→organizations read used
  // elsewhere — through the ACTING client, so RLS returns only orgs this user
  // is an ACTIVE member of: soft-deleted orgs (deleted_at IS NOT NULL) are
  // already excluded by the organizations SELECT policy, so every name here is
  // active. Compare both sides trimmed + case-insensitive.
  //
  // SCOPE — intentionally PER-USER, not global: two unrelated tenants may share
  // a name BY DESIGN, so we do NOT check every org in the system. This only
  // stops one person from creating two same-named orgs that would be
  // indistinguishable in their OWN switcher.
  //
  // NOT a DB UNIQUE constraint: per-user uniqueness can't be expressed as one
  // (there is no owner column on organizations to key it against), and this is
  // a USABILITY guard, not a security boundary — so it lives here in the seam.
  const existingOrgs = await getUserOrganizations(actingClient, actingUser.id);
  const clash = existingOrgs.some(
    (o) => o.organizationName.trim().toLowerCase() === organizationName.toLowerCase()
  );
  // No organization row has been inserted yet, so there is NOTHING to roll back
  // here — we simply return before provisioning begins.
  if (clash) return fail("nameExists");

  // --- Privileged provisioning (service role) --------------------------------
  // Track what we created so we can roll back on any later failure.
  let createdOrgId: string | null = null;

  const rollback = async (): Promise<void> => {
    // ORG-ONLY: no auth user is created here (the user already exists), so unlike
    // the sibling functions there is nothing to delete but the org. Deleting the
    // org cascades its roles/memberships. Best-effort; ignore secondary errors.
    if (createdOrgId) await serviceClient.from("organizations").delete().eq("id", createdOrgId);
  };

  // 1) The ROOT organization — NO parent_id, so it hangs off nothing.
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

  // 3) The acting user's membership in their new org.
  const membershipRes = await serviceClient
    .from("memberships")
    .insert({ user_id: actingUser.id, organization_id: createdOrgId })
    .select("id")
    .single();
  if (membershipRes.error || !membershipRes.data) {
    await rollback();
    return fail("createFailed");
  }

  // 4) Assign the acting user the Admin role. This service-client insert relies
  //    on the BOOTSTRAP EXEMPTION in 20260717000003: the escalation trigger
  //    waves through the first assignment in an org with ZERO membership_roles
  //    rows (a just-created org has no admin yet who could authorize one).
  //    One-shot per org BY CONSTRUCTION — this very row closes the exemption
  //    behind it.
  const mrRes = await serviceClient.from("membership_roles").insert({
    membership_id: (membershipRes.data as { id: string }).id,
    role_id: adminRoleId,
    organization_id: createdOrgId,
  });
  if (mrRes.error) {
    await rollback();
    return fail("createFailed");
  }

  return { error: null, organizationId: createdOrgId };
}

export interface HideOrganizationInput {
  organizationId: string;
}
export interface HideOrganizationResult {
  error: string | null;
}

/**
 * SOFT-DELETE an organization the current user belongs to: stamp
 * `organizations.deleted_at = now()`. Reversible, NO data loss, NO cascade —
 * every membership, role and tool row survives untouched; clearing `deleted_at`
 * fully restores the org. This is deliberately NOT a hard delete.
 *
 * WHY IT VANISHES FROM THE SWITCHER WITH NO CLIENT-SIDE HIDING: the
 * organizations SELECT policy is `deleted_at IS NULL AND auth_user_is_member_of(id)`
 * (20260610000001), and the membership helpers are deleted_at-aware, so a
 * soft-deleted org drops out of every RLS read — the switcher, which lists orgs
 * THROUGH RLS, simply stops seeing it. Nothing filters it out in the client.
 *
 * TWO GUARDS, both refusals rather than damage:
 *  - NOT THE LAST ORG (`cannotHideLastOrg`): hiding a user's only remaining
 *    active org would strand them with no active context to fall back to, so we
 *    refuse when this is their sole active membership.
 *  - SOLO ONLY (`orgHasOtherMembers`): an org other people are actively members
 *    of is shared infrastructure — one member must not be able to yank it out
 *    from under the others, so we refuse unless the caller is its only active
 *    member.
 *
 * TWO CLIENTS, same split as the sibling functions:
 *  - `actingClient` (actor's JWT, RLS-scoped): the "logged in" gate and the
 *    membership check — RLS guarantees a non-member cannot even see the org.
 *  - `serviceClient` (service-role, bypasses RLS): the single UPDATE, which has
 *    no client UPDATE policy.
 */
export async function hideOrganizationForCurrentUser(
  actingClient: SupabaseClient,
  serviceClient: SupabaseClient,
  input: HideOrganizationInput
): Promise<HideOrganizationResult> {
  const fail = (error: string): HideOrganizationResult => ({ error });

  // --- Authorization (acting client, RLS-scoped) — the security boundary -----
  const actingUser = await getCurrentUser(actingClient);
  if (!actingUser) return fail("notAllowed");

  // 2) Membership check THROUGH RLS: the user must be an ACTIVE member of the
  //    target org. RLS already scopes this — a non-member cannot see the org's
  //    memberships at all — so a zero-row read IS the "not a member" answer.
  const membershipRes = await actingClient
    .from("memberships")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("user_id", actingUser.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (membershipRes.error || !membershipRes.data) return fail("notAllowed");

  // 3) GUARD — NOT THE LAST ORG. getUserOrganizations runs through the acting
  //    client, so RLS returns only orgs the user is an ACTIVE member of. If the
  //    target is their ONLY remaining active org, hiding it would leave them
  //    with no active context — refuse.
  const activeOrgs = await getUserOrganizations(actingClient, actingUser.id);
  if (activeOrgs.length <= 1) return fail("cannotHideLastOrg");

  // 4) GUARD — SOLO ONLY. Count ACTIVE members of the target org via the service
  //    client (an authoritative count, not RLS-narrowed). More than one active
  //    member means the org is shared — you cannot hide an organization other
  //    people are actively using — so refuse.
  const membersRes = await serviceClient
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", input.organizationId)
    .is("deleted_at", null);
  if (membersRes.error) return fail("hideFailed");
  if ((membersRes.count ?? 0) > 1) return fail("orgHasOtherMembers");

  // 5) THE SOFT DELETE. Stamp deleted_at only if it is still NULL (idempotent —
  //    a double-submit cannot re-stamp an already-hidden org). Nothing cascades;
  //    all rows survive; clearing deleted_at reverses this entirely.
  const nowIso = new Date().toISOString();
  const updateRes = await serviceClient
    .from("organizations")
    .update({ deleted_at: nowIso })
    .eq("id", input.organizationId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (updateRes.error || !updateRes.data) return fail("hideFailed");

  return { error: null };
}
