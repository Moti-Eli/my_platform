"use server";

import { hideOrganizationForCurrentUser } from "@platform/auth";
import { requireSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createCortexAdminClient } from "@/lib/supabase/admin";
import type { MessageKey } from "@/i18n";

export interface HideOrgState {
  /** A `profile.hideOrg*` i18n key, or null. NEVER a raw server message — same
   *  never-render-raw rule as createOrgAction. */
  error: MessageKey | null;
  /** True on a successful soft-delete. The client uses it to router.refresh()
   *  once per success so the hidden row disappears (a fresh nonce each time). */
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
 * Soft-delete (hide) an organization the signed-in user belongs to. Mirrors
 * createOrgAction's shape exactly: identity comes from the session, never the
 * caller; the RLS server client is the acting client; the service client does
 * the privileged write.
 *
 * SECURITY — the user id is NEVER taken from `formData`. `requireSession()` is
 * the access boundary, and the seam re-derives the acting user from the RLS
 * client's JWT and re-checks membership through RLS. The form supplies only the
 * organization id (and RLS makes an id the caller cannot see a no-op).
 */
export async function hideOrgAction(
  _prev: HideOrgState,
  formData: FormData
): Promise<HideOrgState> {
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

  const { error } = await hideOrganizationForCurrentUser(supabase, serviceClient, {
    organizationId,
  });
  if (error) return { error: toHideOrgErrorKey(error), hiddenNonce: null };

  // A fresh nonce per success so back-to-back hides each trigger one refresh.
  return { error: null, hiddenNonce: `${organizationId}:${Date.now()}` };
}
