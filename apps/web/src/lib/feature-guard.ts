// SERVER-ONLY. The registry-driven route guard — THE access boundary for a
// feature's page (hiding a nav link is only UX; ARCHITECTURE.md #13/#16/#17).
import "server-only";

import { redirect } from "next/navigation";
import {
  getCurrentUser,
  getUserOrganizations,
  hasPermission,
  isPlatformOwner,
} from "@platform/auth";
import { FEATURES } from "@platform/core";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ServerClient = NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>;
type AuthUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

export interface FeatureAccess {
  /** The authenticated, RLS-scoped server client — reuse it to render the page. */
  supabase: ServerClient;
  /** The authenticated user. */
  user: AuthUser;
}

/**
 * Enforce access to the feature `id` (looked up in the @platform/core registry),
 * reproducing EXACTLY the redirect behavior of the hand-written guards it
 * replaces:
 *
 *   - no Supabase config, or not signed in        -> /{locale}/login
 *   - feature.enabled === false                    -> /{locale}/dashboard
 *   - feature.ownerOnly and not a platform owner   -> /{locale}/dashboard
 *   - feature.requiredPermission and lacks it      -> /{locale}/dashboard
 *
 * Returns the authenticated client + user so the page renders without
 * re-fetching (a single getCurrentUser call, exactly as before).
 *
 * NOTE — `requiredPermission` is DORMANT today: none of the three registered web
 * features sets it (members/chat are `null`, platform is `ownerOnly`), so that
 * branch never executes in the current config. Its org-resolution semantics —
 * the permission must be held in AT LEAST ONE of the user's organizations — is a
 * forward-looking default to confirm when the first permission-gated feature
 * actually lands. It reuses the existing "insufficient -> /dashboard" destination
 * (no new redirect contract is invented).
 */
export async function requireFeatureAccess(id: string, locale: string): Promise<FeatureAccess> {
  const feature = FEATURES.find((f) => f.id === id);
  if (!feature) {
    // Unknown id = a programming error, never user-reachable. Fail closed.
    redirect(`/${locale}/dashboard`);
  }

  // Login boundary — identical to every current page guard.
  const supabase = await createSupabaseServerClient();
  const user = supabase ? await getCurrentUser(supabase) : null;
  if (!supabase || !user) {
    redirect(`/${locale}/login`);
  }

  // Kill switch: a disabled feature is unreachable everywhere (matches the nav
  // hiding it). All current features are enabled, so this is dormant.
  if (!feature.enabled) {
    redirect(`/${locale}/dashboard`);
  }

  // Owner-only boundary — identical to the current /platform guard.
  if (feature.ownerOnly && !(await isPlatformOwner(supabase))) {
    redirect(`/${locale}/dashboard`);
  }

  // Permission boundary — dormant (see NOTE above).
  if (feature.requiredPermission) {
    const organizations = await getUserOrganizations(supabase, user.id);
    let allowed = false;
    for (const org of organizations) {
      if (await hasPermission(supabase, user.id, org.organizationId, feature.requiredPermission)) {
        allowed = true;
        break;
      }
    }
    if (!allowed) {
      redirect(`/${locale}/dashboard`);
    }
  }

  return { supabase, user };
}
