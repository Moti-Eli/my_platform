// SERVER-ONLY. Reaches the secret-key admin client (via the `server-only` admin
// module), so it must never be imported by client code.
import "server-only";

import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@platform/db";
import { createOrganizationWithFirstAdmin, getCurrentUser, isPlatformOwner } from "@platform/auth";
import { captureException, logger } from "@platform/observability";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Shared privileged "create organization + first admin" flow — the single home
 * for this logic, called by BOTH the web server action and the mobile-facing API
 * route handler (zero duplication of the privileged path).
 *
 * SECURITY (see ARCHITECTURE.md #17 and #26):
 * - `authClient` MUST be authenticated as the acting user. We re-verify
 *   `isPlatformOwner` on that RLS-scoped client FIRST (the security boundary),
 *   and only AFTER it passes do we construct the secret-key admin client.
 * - `createOrganizationWithFirstAdmin` re-checks ownership a second time and
 *   rolls back on any failure (no half-provisioned tenant).
 */
export interface CreateOrgInput {
  organizationName: string;
  adminEmail: string;
  adminDisplayName: string;
}

export interface CreateOrgResult {
  /** An i18n key under the "platform" namespace, or null on success. */
  error: string | null;
  organizationId: string | null;
  adminUserId: string | null;
  createdOrgName: string | null;
  createdAdminEmail: string | null;
  /** Dev only: the known temp password to show. Null in production. */
  tempPassword: string | null;
}

/** DB CHECK caps names at 200 raw chars (see SCHEMA.md). Reject before the DB. */
const MAX_NAME_LEN = 200;

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

export async function createOrganizationForOwner(
  authClient: SupabaseClient,
  input: CreateOrgInput
): Promise<CreateOrgResult> {
  const organizationName = input.organizationName.trim();
  const adminEmail = input.adminEmail.trim();
  const adminDisplayName = input.adminDisplayName.trim();

  const EMPTY = {
    organizationId: null,
    adminUserId: null,
    createdOrgName: null,
    createdAdminEmail: null,
    tempPassword: null,
  } as const;
  const fail = (error: string): CreateOrgResult => ({ error, ...EMPTY });

  // --- Length validation (raw) before touching the DB -----------------------
  // Emptiness/email are validated inside createOrganizationWithFirstAdmin; here
  // we add the over-length guard the DB CHECK enforces (200 raw chars).
  if (input.organizationName.length > MAX_NAME_LEN) return fail("invalidOrgName");
  if (input.adminDisplayName.length > MAX_NAME_LEN) return fail("invalidName");

  // --- Authorization: server-side owner re-check (RLS-scoped client) --------
  if (!(await isPlatformOwner(authClient))) return fail("notAllowed");

  // --- Privileged client — built only after the owner check above -----------
  const admin = createSupabaseAdminClient();
  if (!admin) return fail("notConfigured");

  const actor = await getCurrentUser(authClient);
  const result = await createOrganizationWithFirstAdmin(authClient, admin, {
    organizationName,
    adminEmail,
    adminDisplayName,
    adminPassword: newFirstAdminPassword(),
  });
  if (result.error) {
    if (result.error === "createFailed") {
      captureException(new Error("createOrganizationWithFirstAdmin failed"), {
        action: "createOrganization",
        actorId: actor?.id,
      });
    }
    return fail(toI18nKey(result.error));
  }

  logger.info("organization created", {
    action: "createOrganization",
    actorId: actor?.id,
    organizationId: result.organizationId,
    adminUserId: result.adminUserId,
  });
  return {
    error: null,
    organizationId: result.organizationId,
    adminUserId: result.adminUserId,
    createdOrgName: organizationName,
    createdAdminEmail: adminEmail,
    tempPassword: process.env.NODE_ENV !== "production" ? DEV_TEMP_PASSWORD : null,
  };
}
