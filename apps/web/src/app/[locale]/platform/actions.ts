"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createOrganizationWithFirstAdmin, isPlatformOwner } from "@platform/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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
 * Known DEV-ONLY temp password for the first admin (matches the seed) so the
 * demo can log in immediately. In production we mint a cryptographically random,
 * never-disclosed password instead — same NODE_ENV gate as add-member's
 * `newUserPassword()`. Production must still wire invite/forced-reset before this
 * is user-facing (see SCHEMA.md / ARCHITECTURE.md #16/#17).
 */
const DEV_TEMP_PASSWORD = "123456";
function newFirstAdminPassword(): string {
  if (process.env.NODE_ENV === "production") return randomBytes(24).toString("base64url");
  return DEV_TEMP_PASSWORD;
}

/** Map a createOrganizationWithFirstAdmin error key to a "platform" i18n key. */
function toI18nKey(key: string): string {
  switch (key) {
    case "notAllowed":
    case "invalidOrgName":
    case "invalidEmail":
    case "invalidName":
    case "emailExists":
      return key;
    default:
      return "createFailed";
  }
}

/**
 * Server action: create a new organization + its first admin.
 *
 * SECURITY (see ARCHITECTURE.md #17):
 * - Re-verifies the acting user is a platform owner SERVER-SIDE before doing
 *   anything — we never trust the page guard alone.
 * - The privileged service-role client is built ONLY AFTER that owner check
 *   passes, and only ever server-side (see src/lib/supabase/admin.ts, which is
 *   `server-only`). createOrganizationWithFirstAdmin re-checks ownership a second
 *   time as well and rolls back on any failure.
 */
export async function createOrganizationAction(
  _prev: CreateOrgState,
  formData: FormData
): Promise<CreateOrgState> {
  const organizationName = String(formData.get("organizationName") ?? "").trim();
  const adminEmail = String(formData.get("adminEmail") ?? "").trim();
  const adminDisplayName = String(formData.get("adminDisplayName") ?? "").trim();
  const locale = String(formData.get("locale") ?? "he");

  // --- Authorization: server-side owner re-check ----------------------------
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "notAllowed", ...EMPTY };
  if (!(await isPlatformOwner(supabase))) return { error: "notAllowed", ...EMPTY };

  // --- Privileged client — built only after the owner check above -----------
  const admin = createSupabaseAdminClient();
  if (!admin) return { error: "notConfigured", ...EMPTY };

  const result = await createOrganizationWithFirstAdmin(supabase, admin, {
    organizationName,
    adminEmail,
    adminDisplayName,
    adminPassword: newFirstAdminPassword(),
  });
  if (result.error) return { error: toI18nKey(result.error), ...EMPTY };

  revalidatePath(`/${locale}/platform`);
  return {
    error: null,
    createdOrgName: organizationName,
    createdAdminEmail: adminEmail,
    tempPassword: process.env.NODE_ENV !== "production" ? DEV_TEMP_PASSWORD : null,
  };
}
