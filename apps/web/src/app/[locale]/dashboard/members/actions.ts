"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
