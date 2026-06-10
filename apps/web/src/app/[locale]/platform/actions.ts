"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createOrganizationForOwner } from "@/lib/admin/create-organization";

export interface CreateOrgState {
  /** An i18n key under the "platform" namespace, or null on success. */
  error: string | null;
  /** Set on success: the created org's name. */
  createdOrgName: string | null;
  /** Set on success: the first admin's email. */
  createdAdminEmail: string | null;
  /** Dev only: the known temp password to show. Null in production. */
  tempPassword: string | null;
}

const EMPTY = { createdOrgName: null, createdAdminEmail: null, tempPassword: null } as const;

/**
 * Server action: create a new organization + its first admin. Thin wrapper
 * around the shared privileged flow (`createOrganizationForOwner`), which is the
 * single home for the authorize-then-act logic also used by the mobile-facing
 * API route handler. Behavior is unchanged: ownership is re-verified server-side
 * with the authenticated client before the secret key is constructed, and
 * `createOrganizationWithFirstAdmin` re-checks + rolls back (ARCHITECTURE.md
 * #17/#26).
 */
export async function createOrganizationAction(
  _prev: CreateOrgState,
  formData: FormData
): Promise<CreateOrgState> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "notAllowed", ...EMPTY };

  const result = await createOrganizationForOwner(supabase, {
    organizationName: String(formData.get("organizationName") ?? ""),
    adminEmail: String(formData.get("adminEmail") ?? ""),
    adminDisplayName: String(formData.get("adminDisplayName") ?? ""),
  });
  if (result.error) return { error: result.error, ...EMPTY };

  const locale = String(formData.get("locale") ?? "he");
  revalidatePath(`/${locale}/platform`);
  return {
    error: null,
    createdOrgName: result.createdOrgName,
    createdAdminEmail: result.createdAdminEmail,
    tempPassword: result.tempPassword,
  };
}
