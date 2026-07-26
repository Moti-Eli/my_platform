/**
 * Set-password — the destination of the recovery link (via /confirm).
 *
 * PROTECTED, unlike /login: you reach it only WITH a session, because /confirm's
 * verifyOtp just wrote one. It does not call requireSession() (that would demand
 * an ORGANIZATION and redirect a brand-new, org-less recovering user to
 * /no-organization) — it needs only "is there a user", so it does the lighter
 * getUser check itself. No user -> /login.
 *
 * Renders in the bare `(auth)` layout (wordmark + centred column, no app shell),
 * exactly like /login. A server component with a client form child — the same
 * split /login uses: the form needs `useActionState`/`useI18n`, the guard needs
 * the server.
 */
import { redirect } from "next/navigation";
import { getCurrentUser } from "@platform/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SetPasswordForm } from "./SetPasswordForm";

export default async function SetPasswordPage() {
  const supabase = await createSupabaseServerClient();
  const user = supabase ? await getCurrentUser(supabase) : null;
  if (!user) redirect("/login");

  return <SetPasswordForm />;
}
