"use server";

import { revalidatePath } from "next/cache";
import { captureException, logger } from "@platform/observability";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { addMemberToOrganization } from "@/lib/admin/add-member";

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
  if (rolesRes.error) {
    captureException(rolesRes.error, { action: "updateMemberRole", organizationId, membershipId });
    return { error: "updateFailed" };
  }
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
  if (upsert.error) {
    logger.warn("membership_roles write denied", {
      action: "updateMemberRole",
      organizationId,
      membershipId,
      code: upsert.error.code,
    });
    return { error: "notAllowed" };
  }

  const del = await supabase
    .from("membership_roles")
    .delete()
    .eq("membership_id", membershipId)
    .eq("role_id", removeRoleId)
    .eq("organization_id", organizationId);
  if (del.error) {
    logger.warn("membership_roles write denied", {
      action: "updateMemberRole",
      organizationId,
      membershipId,
      code: del.error.code,
    });
    return { error: "notAllowed" };
  }

  logger.info("member role updated", { action: "updateMemberRole", organizationId, membershipId, targetRole });
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
 * Add a brand-new user to an organization. Thin wrapper around the shared
 * privileged flow (`addMemberToOrganization`), which is the single home for the
 * authorize-then-act logic also used by the mobile-facing API route handler.
 * Behavior is unchanged: authorization is re-checked server-side with the
 * authenticated (RLS-scoped) client before the secret key is ever constructed
 * (see ARCHITECTURE.md #16/#26).
 */
export async function addMemberAction(
  _prev: AddMemberState,
  formData: FormData
): Promise<AddMemberState> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "notAllowed", success: false };

  const result = await addMemberToOrganization(supabase, {
    email: String(formData.get("email") ?? ""),
    displayName: String(formData.get("displayName") ?? ""),
    targetRole: String(formData.get("targetRole") ?? ""),
    organizationId: String(formData.get("orgId") ?? ""),
  });
  if (result.error) return { error: result.error, success: false };

  const locale = String(formData.get("locale") ?? "he");
  revalidatePath(`/${locale}/dashboard/members`);
  return { error: null, success: true };
}
