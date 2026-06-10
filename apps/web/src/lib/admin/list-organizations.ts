// SERVER-ONLY. Reaches the secret-key admin client (via the `server-only` admin
// module), so it must never be imported by client code.
import "server-only";

import type { SupabaseClient } from "@platform/db";
import { isPlatformOwner } from "@platform/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Shared "list every organization" read for the platform-owner surface — the
 * single home for the owner-recheck-then-service-client pattern, called by the
 * mobile-facing GET /api/admin/organizations handler.
 *
 * SECURITY (see ARCHITECTURE.md #17/#26): by RLS approach (b) the authenticated
 * (publishable) client CANNOT read across orgs, so the full list requires the
 * service-role client. We therefore re-verify `isPlatformOwner` on the RLS-scoped
 * `authClient` FIRST (the boundary), and only AFTER it passes build the admin
 * client. Active orgs only — soft-deleted rows (`deleted_at`) are excluded.
 */
export interface OrgListRow {
  id: string;
  name: string;
  memberCount: number;
  createdAt: string;
}

export interface ListOrgsResult {
  /** An i18n key under the "platform" namespace, or null on success. */
  error: string | null;
  organizations: OrgListRow[];
}

export async function listOrganizations(authClient: SupabaseClient): Promise<ListOrgsResult> {
  const fail = (error: string): ListOrgsResult => ({ error, organizations: [] });

  // --- Authorization: owner re-check on the RLS-scoped client ----------------
  if (!(await isPlatformOwner(authClient))) return fail("notAllowed");

  // --- Privileged read — built only after the owner check above -------------
  const admin = createSupabaseAdminClient();
  if (!admin) return fail("notConfigured");

  // Active orgs + active memberships only (respect soft deletes).
  const [orgsRes, memRes] = await Promise.all([
    admin
      .from("organizations")
      .select("id, name, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
    admin.from("memberships").select("organization_id").is("deleted_at", null),
  ]);
  if (orgsRes.error || memRes.error) return fail("loadError");

  const counts = new Map<string, number>();
  for (const m of (memRes.data ?? []) as Array<{ organization_id: string }>) {
    counts.set(m.organization_id, (counts.get(m.organization_id) ?? 0) + 1);
  }
  const organizations = (
    (orgsRes.data ?? []) as Array<{ id: string; name: string; created_at: string }>
  ).map((o) => ({ id: o.id, name: o.name, createdAt: o.created_at, memberCount: counts.get(o.id) ?? 0 }));

  return { error: null, organizations };
}
