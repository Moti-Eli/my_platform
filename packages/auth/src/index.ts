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
