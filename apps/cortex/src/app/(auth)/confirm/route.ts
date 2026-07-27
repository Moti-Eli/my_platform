/**
 * OTP CONFIRM DOOR — GET /confirm.
 *
 * Where an emailed auth link lands. Supabase builds the link from the local
 * stack's `site_url` (config.toml) as `<site>/confirm?token_hash=…&type=…`; this
 * handler exchanges that one-time hash for a real session, then forwards to the
 * screen the flow wants (`next`, default /set-password — the recovery flow).
 *
 * The exchange is `verifyOtp`: on success the SSR client (createServerDbClient's
 * cookie adapter) writes the session cookies itself as a side effect of the call,
 * so there is nothing to persist here — we just redirect. On any failure (missing
 * params, no Supabase env, an expired or already-used hash) we send the user back
 * to /login; the expired case carries `?error=expired` so the login page can say
 * so, quietly, above the form.
 *
 * `type` defaults to "recovery" (the password-reset link) and is validated against
 * the set of email OTP types — an unknown value falls back to "recovery" rather
 * than reaching GoTrue. `next` is sanitised to a same-origin relative path (via the
 * shared {@link safeRelativePath}, which ACCEPTS a query string like
 * "/set-password?next=/tools/questionnaire" while still rejecting off-site targets)
 * so the confirm link can never be turned into an open redirect.
 */
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeRelativePath } from "@/lib/safe-next";

/** The email OTP types GoTrue accepts for a token-hash verification. Declared
 * locally (a plain string union) so the app never imports @supabase/* directly —
 * that dependency lives only in @platform/db. */
const EMAIL_OTP_TYPES = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
] as const;
type EmailOtpType = (typeof EMAIL_OTP_TYPES)[number];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const rawType = url.searchParams.get("type");
  // The recovery screen is the default when `next` is absent or off-site.
  const next = safeRelativePath(url.searchParams.get("next"), "/set-password");

  const type: EmailOtpType = EMAIL_OTP_TYPES.includes(rawType as EmailOtpType)
    ? (rawType as EmailOtpType)
    : "recovery";

  const supabase = await createSupabaseServerClient();
  // No env, or no hash to verify — nothing to do but send them to sign in.
  if (!supabase || !tokenHash) {
    redirect("/login");
  }

  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) {
    // Expired / already-used / invalid hash — back to login with a quiet notice.
    redirect("/login?error=expired");
  }

  // Success: the SSR client already wrote the session cookies. Move on.
  redirect(next);
}
