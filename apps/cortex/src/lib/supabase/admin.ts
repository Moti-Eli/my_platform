// SERVER-ONLY. Importing this module from a Client Component is a build error —
// the `server-only` package guarantees the secret key can never be bundled into
// client JavaScript. This is the ONLY place Cortex touches the secret key.
import "server-only";

import { createAdminDbClient, type SupabaseClient } from "@platform/db";

/**
 * The privileged (secret-key / service-role) Supabase client. It BYPASSES RLS, so
 * in Cortex it is used for exactly ONE thing: the shell's own audit writes to
 * `ai_log` and `events`, which `authenticated` is not granted and must not be
 * (the subject of an audit does not write it). It is never used to READ tool data
 * — that would erase `auth_user_can_read`.
 *
 * ============================================================================
 * THE NAME HAS NO NEXT_PUBLIC_ PREFIX, AND THAT ABSENCE IS THE WHOLE DEFENCE.
 * ============================================================================
 * Next inlines exactly the `NEXT_PUBLIC_`-prefixed env names into the browser
 * bundle and nothing else. `SUPABASE_SECRET_KEY` has no such prefix precisely so
 * it stays server-side. DO NOT "make it consistent" with the two
 * `NEXT_PUBLIC_SUPABASE_*` vars — a prefix here would ship a full-privilege,
 * RLS-bypassing key to every visitor. The publishable key is safe to expose; this
 * one ends the application's security if it leaks.
 *
 * ============================================================================
 * FAILS LOUD. A missing key THROWS — it never returns a null/degraded client.
 * ============================================================================
 * The degrade-not-crash pattern is right for the login page (an absent env there
 * should render a "not configured" notice, not a stack trace). It is WRONG here:
 * this client backs the mandatory audit write on every runIntent call, so a
 * missing key must crash with the reason NAMED, never silently degrade into
 * something that looks like "no rows". A permission/absence error that masquerades
 * as an empty result is the exact failure this project has been bitten by.
 */
export function createCortexAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url) {
    throw new Error("Cortex admin client: NEXT_PUBLIC_SUPABASE_URL is not set.");
  }
  if (!secretKey) {
    throw new Error(
      "Cortex admin client: SUPABASE_SECRET_KEY is not set. It is server-only and " +
        "must NEVER be given a NEXT_PUBLIC_ prefix. Set it in apps/cortex/.env."
    );
  }
  return createAdminDbClient(url, secretKey);
}
