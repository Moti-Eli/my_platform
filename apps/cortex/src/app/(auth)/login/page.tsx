/**
 * Login — THE ONLY PUBLICLY-REACHABLE PAGE IN CORTEX.
 *
 * It carries an IDENTITY-ONLY redirect-if-authenticated guard, and deliberately
 * nothing more. The distinction matters:
 *   - It must NEVER call requireSession(): that guard sends an unauthenticated
 *     caller to /login, and this IS /login, so it would loop. That reasoning is
 *     unchanged and is why the full guard stays out.
 *   - But it MAY check identity alone. An already-authenticated user has no
 *     business seeing the form, so we bounce them to "/" — which also stops the
 *     Android back button from returning to /login after a successful login
 *     (the success redirect leaves /login in history; re-rendering here on the
 *     way back ejects them). We forward on IDENTITY ONLY — no memberships query —
 *     so a logged-in user with zero orgs is still forwarded to "/", where
 *     requireSession() routes them on to /no-organization. Deciding that here
 *     would duplicate requireSession's logic, worse.
 *   - When the client is null (unconfigured env) we render the form as before:
 *     this guard is UX, not a security boundary (that lives in requireSession on
 *     every protected page — see src/lib/session.ts for the full per-page table),
 *     so it must degrade gracefully rather than block the login surface.
 *
 * Lives in the `(auth)` group, so it renders in the bare layout — no shell — at
 * the unchanged url `/login`. That layout owns the `<main>`, the centred column
 * and the wordmark; this page contributes the heading and the form only. (It used
 * to render its own `<main>` INSIDE AppShell's — a nested main, which is invalid.)
 *
 * A server component with client children — the same split every protected route
 * uses: here the server half runs the identity guard, and `useActionState` /
 * `useI18n` in the form children need the client.
 */
import { redirect } from "next/navigation";
import { getCurrentUser } from "@platform/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AuthPanel } from "./AuthPanel";

/**
 * `?error=expired` arrives here from /confirm when a recovery/OTP link was
 * expired or already used. We translate it into a single `login.*` key and hand
 * it to the panel to render as a quiet notice above the form — nothing else in
 * the query string is trusted or displayed.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  // Identity-only redirect-if-authenticated guard. See the header note: an
  // authenticated user is bounced to "/" (never requireSession here — that would
  // loop), and a null client falls through to render the form (guard is UX, not
  // a boundary). No memberships query: forwarding on identity alone lets
  // requireSession() on "/" own the zero-org -> /no-organization decision.
  const supabase = await createSupabaseServerClient();
  if (supabase) {
    const user = await getCurrentUser(supabase);
    if (user) redirect("/");
  }

  return <AuthPanel notice={error === "expired" ? "login.linkExpired" : null} />;
}
