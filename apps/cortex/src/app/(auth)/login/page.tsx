/**
 * Login — THE ONLY PUBLIC PAGE IN CORTEX.
 *
 * It calls no guard, deliberately and necessarily: this page is how a session is
 * obtained, so guarding it would be a redirect loop. Every other page under
 * src/app calls requireSession() itself (see src/lib/session.ts for the full
 * per-page table).
 *
 * Lives in the `(auth)` group, so it renders in the bare layout — no shell — at
 * the unchanged url `/login`. That layout owns the `<main>`, the centred column
 * and the wordmark; this page contributes the heading and the form only. (It used
 * to render its own `<main>` INSIDE AppShell's — a nested main, which is invalid.)
 *
 * A server component with client children — the same split every protected route
 * uses, for a different reason: here it is `useActionState` and `useI18n` that
 * need the client, not a guard that needs the server.
 */
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
  return <AuthPanel notice={error === "expired" ? "login.linkExpired" : null} />;
}
