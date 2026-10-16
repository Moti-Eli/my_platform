"use server";

import {
  hideOrganizationForCurrentUser,
  leaveOrganizationForCurrentUser,
} from "@platform/auth";
import { requireSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createCortexAdminClient } from "@/lib/supabase/admin";
import type { MessageKey } from "@/i18n";

export interface RemoveOrgState {
  /** A `profile.*` i18n key, or null. NEVER a raw server message — same
   *  never-render-raw rule as createOrgAction. */
  error: MessageKey | null;
  /** Set on EITHER kind of success (hide OR leave) so the existing nonce-guarded
   *  router.refresh() drops the now-gone row. A fresh value each time. */
  hiddenNonce: string | null;
}

/**
 * Map a `hideOrganizationForCurrentUser` error key onto a translated
 * `profile.hideOrg*` key. The seam returns a short stable key; we never render
 * the raw key. Anything unrecognized collapses to the generic `failed`.
 */
function toHideOrgErrorKey(key: string): MessageKey {
  switch (key) {
    case "notAllowed":
      return "profile.hideOrgNotAllowed";
    case "cannotHideLastOrg":
      return "profile.hideOrgLastOrg";
    case "orgHasOtherMembers":
      return "profile.hideOrgHasMembers";
    default:
      return "profile.hideOrgFailed";
  }
}

/**
 * Map a `leaveOrganizationForCurrentUser` error key onto a translated key.
 * `notAllowed` reuses the shared hide message; the rest are leave-specific.
 * `orgHasOtherMembers` cannot come from the leave seam — but we stay exhaustive
 * and never surface a raw code, so the default catches anything unrecognized.
 */
function toLeaveOrgErrorKey(key: string): MessageKey {
  switch (key) {
    case "notAllowed":
      return "profile.hideOrgNotAllowed";
    case "cannotLeaveLastOrg":
      return "profile.leaveOrgLastOrg";
    case "lastAdminMustHandOff":
      return "profile.leaveOrgLastAdmin";
    default:
      return "profile.leaveOrgFailed";
  }
}

/**
 * Remove an organization from the signed-in user's list. ONE control, TWO
 * branches, decided SERVER-SIDE by how many ACTIVE members the target org has:
 *   - solo   (<= 1 active member) -> hideOrganizationForCurrentUser (soft-delete
 *                                    the ORG itself; reversible)
 *   - shared (>  1 active member) -> leaveOrganizationForCurrentUser (soft-delete
 *                                    just the CALLER'S membership; org survives)
 *
 * Shape mirrors the old hideOrgAction exactly: identity comes from the session,
 * never the caller; the RLS server client is the acting client; the service
 * client does the privileged write. `hiddenNonce` is set on EITHER success so the
 * client's nonce-guarded refresh keeps working unchanged.
 *
 * SECURITY — the user id is NEVER taken from `formData`. `requireSession()` is the
 * access boundary, and each seam re-derives the acting user from the RLS client's
 * JWT and re-checks membership through RLS. The member count read below (service
 * client, so the `deleted_at` filter is explicit since RLS is bypassed) ONLY picks
 * the branch — both seams still authorize themselves, so it grants nothing.
 */
export async function removeOrgAction(
  _prev: RemoveOrgState,
  formData: FormData
): Promise<RemoveOrgState> {
  const organizationId = String(formData.get("organizationId") ?? "");

  await requireSession();

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "profile.hideOrgNotConfigured", hiddenNonce: null };

  let serviceClient;
  try {
    serviceClient = createCortexAdminClient();
  } catch {
    return { error: "profile.hideOrgNotConfigured", hiddenNonce: null };
  }

  // Count the target org's ACTIVE members to choose the branch. This selects the
  // seam only; it confers no access (each seam re-checks the caller itself).
  const membersRes = await serviceClient
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .is("deleted_at", null);
  if (membersRes.error) return { error: "profile.hideOrgFailed", hiddenNonce: null };

  if ((membersRes.count ?? 0) > 1) {
    // Shared org -> LEAVE: drop only the caller's membership; the org survives.
    const { error } = await leaveOrganizationForCurrentUser(supabase, serviceClient, {
      organizationId,
    });
    if (error) return { error: toLeaveOrgErrorKey(error), hiddenNonce: null };
  } else {
    // Solo org -> HIDE: soft-delete the org itself (reversible).
    const { error } = await hideOrganizationForCurrentUser(supabase, serviceClient, {
      organizationId,
    });
    if (error) return { error: toHideOrgErrorKey(error), hiddenNonce: null };
  }

  // A fresh nonce per success (either branch) so back-to-back removes each refresh.
  return { error: null, hiddenNonce: `${organizationId}:${Date.now()}` };
}
