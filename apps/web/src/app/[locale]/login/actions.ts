"use server";

import { redirect } from "next/navigation";
import { signIn } from "@platform/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface LoginState {
  /** An i18n key under the "login" namespace, or null. */
  error: string | null;
}

/**
 * Server action for the login form. Signs the user in (which sets the session
 * cookies server-side) and redirects to the dashboard, or returns a translated
 * error key on failure.
 */
export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const locale = String(formData.get("locale") ?? "he");

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "notConfigured" };

  const { error } = await signIn(supabase, email, password);
  if (error) return { error: "invalidCredentials" };

  redirect(`/${locale}/dashboard`);
}
