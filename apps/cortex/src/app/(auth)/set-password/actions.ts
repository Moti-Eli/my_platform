"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@platform/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeRelativePath } from "@/lib/safe-next";
import type { MessageKey } from "@/i18n";

export interface SetPasswordState {
  /** A `setPassword.*` i18n key, or null. NEVER a raw server message — same rule
   * as login/signup: the raw GoTrue text is untranslated and developer-facing. */
  error: MessageKey | null;
}

/**
 * Set (or reset) the signed-in user's password, then land on Home.
 *
 * REQUIRES A SESSION. The recovery link already established one at /confirm
 * (verifyOtp wrote the cookies), so `updateUser({ password })` acts on that
 * authenticated user. If there is somehow no user — the link never ran, or the
 * session lapsed — we redirect to /login rather than attempting the write.
 *
 * Server-side validation MIRRORS the form's (≥6 chars, the two fields match): the
 * client gates the submit for UX, and the server never trusts that gate. On a
 * GoTrue failure we return the generic key; the raw error never reaches the client.
 */
export async function setPasswordAction(
  _prev: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  // Re-sanitise the form's `next` — NEVER trust the hidden field; the same rule and
  // default the page used. Absent/off-site → "/".
  const next = safeRelativePath(String(formData.get("next") ?? ""), "/");

  // Defence in depth — the form validates these too, but never trust the client.
  if (password.length < 6) return { error: "setPassword.tooShort" };
  if (password !== confirmPassword) return { error: "setPassword.mismatch" };

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "setPassword.notConfigured" };

  // getUser guard: no session -> back to login (the recovery link must run first).
  const user = await getCurrentUser(supabase);
  if (!user) redirect("/login");

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "setPassword.failed" };

  // Password set; the session is live. Land on `next` (the invite chain points it at
  // the questionnaire); default "/" behaves exactly as the old sign-in flows did.
  redirect(next);
}
