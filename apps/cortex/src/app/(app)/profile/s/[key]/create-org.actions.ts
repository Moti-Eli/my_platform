"use server";

import { createOrganizationForCurrentUser } from "@platform/auth";
import { requireSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createCortexAdminClient } from "@/lib/supabase/admin";
import type { MessageKey } from "@/i18n";

export interface CreateOrgState {
  /** A `profile.createOrg*` i18n key, or null. NEVER a raw server message — same
   *  never-render-raw rule as loginAction/signupAction. */
  error: MessageKey | null;
  /** The id of the org just created, or null. The client uses it to refresh the
   *  switcher once per successful submit (a fresh id each time). Unlike login/
   *  signup this action does NOT redirect — it returns to the switcher — so it
   *  needs a success signal the client can act on. */
  createdOrgId: string | null;
}

/**
 * Map a `createOrganizationForCurrentUser` error key onto a translated
 * `profile.createOrg*` key. The seam already validated (non-empty trimmed name)
 * and returns a short stable key; we never re-validate and never render the raw
 * key. Anything unrecognized collapses to the generic `failed`.
 */
function toCreateOrgErrorKey(key: string): MessageKey {
  switch (key) {
    case "invalidOrgName":
      return "profile.createOrgInvalidName";
    case "notAllowed":
      return "profile.createOrgNotAllowed";
    case "nameExists":
      return "profile.createOrgNameExists";
    default:
      return "profile.createOrgFailed";
  }
}

/**
 * Create a brand-new ROOT organization for the signed-in user and make them its
 * admin. Mirrors signupAction's shape: identity comes from the session, never the
 * caller; the RLS server client is the acting client; the service client does the
 * privileged provisioning writes.
 *
 * SECURITY — the user id is NEVER taken from `formData`. `requireSession()` is the
 * access boundary (redirects to /login if not signed in), and the seam itself
 * re-derives the acting user from the RLS client's JWT (getCurrentUser). The form
 * supplies only the organization name.
 */
export async function createOrgAction(
  _prev: CreateOrgState,
  formData: FormData
): Promise<CreateOrgState> {
  const organizationName = String(formData.get("organizationName") ?? "");

  // Access boundary: a session must exist. We pass nothing from it to the seam —
  // the seam reads the acting user from the RLS client below.
  await requireSession();

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "profile.createOrgNotConfigured", createdOrgId: null };

  // The admin client FAILS LOUD (throws) when the secret key is absent. Here we
  // want the switcher to degrade, not stack-trace, so we catch and report
  // notConfigured — mirroring signupAction's null-client handling.
  let serviceClient;
  try {
    serviceClient = createCortexAdminClient();
  } catch {
    return { error: "profile.createOrgNotConfigured", createdOrgId: null };
  }

  const { error, organizationId } = await createOrganizationForCurrentUser(
    supabase,
    serviceClient,
    { organizationName }
  );
  if (error) return { error: toCreateOrgErrorKey(error), createdOrgId: null };

  return { error: null, createdOrgId: organizationId };
}
