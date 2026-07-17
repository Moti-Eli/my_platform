"use server";

import { redirect } from "next/navigation";
import { signIn } from "@platform/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MessageKey } from "@/i18n";

export interface LoginState {
  /** A `login.*` i18n key, or null. NEVER a raw server message — see below. */
  error: MessageKey | null;
}

/**
 * Map a sign-in failure onto a translated key.
 *
 * WE NEVER RENDER `err.message`. It is written for developers, is not
 * translated (so it would surface in English inside a Hebrew RTL page), and it
 * can disclose whether an address is registered.
 *
 * ON 401 vs 403 — the standing rule is that they are different answers needing
 * different actions: 401 is "not authenticated, the credentials are wrong, retry
 * and you can succeed"; 403 is "authenticated, but not permitted — retrying
 * cannot help, only an administrator can". Collapsing them tells a 403 user to
 * keep typing a password that is already correct.
 *
 * THE SEAM DOES NOT CARRY THE STATUS. `@platform/auth`'s `SignInResult` is
 * `{ user, error: string | null }` — the HTTP status is discarded before it
 * reaches us, so we cannot branch on it here without changing that package. We
 * deliberately do NOT re-issue signInWithPassword just to read the status: that
 * would be a second failed auth attempt per failure, against real auth, counting
 * toward rate limits. So we match Supabase's own stable error text, and default
 * to the generic key rather than guessing.
 *
 * In practice Cortex's real 403-shaped case is not reachable from this form at
 * all: "authenticated but not permitted to proceed" here means *has no
 * organization*, which happens AFTER a successful sign-in and is handled by
 * requireSession() redirecting to /no-organization.
 */
function toErrorKey(message: string): MessageKey {
  const m = message.toLowerCase();
  // 400/401 from GoTrue — the overwhelmingly common case.
  if (m.includes("invalid login credentials") || m.includes("invalid credentials")) {
    return "login.invalidCredentials";
  }
  if (m.includes("email not confirmed")) return "login.invalidCredentials";
  // 403 from GoTrue — the account exists and authenticates, but is refused.
  if (m.includes("banned") || m.includes("disabled") || m.includes("not allowed")) {
    return "login.notPermitted";
  }
  return "login.failed";
}

/**
 * Sign in, then land on Home. On failure returns a translated key for the form
 * to render; the raw error never reaches the client.
 */
export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "login.notConfigured" };

  const { error } = await signIn(supabase, email, password);
  if (error) return { error: toErrorKey(error) };

  // Land on Home. requireSession() there decides what the user actually sees —
  // including the no-organization state. The login action does not pre-judge it.
  redirect("/");
}
