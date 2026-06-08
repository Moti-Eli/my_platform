"use server";

import { redirect } from "next/navigation";
import { signOut } from "@platform/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Server action: sign the user out and return to the login page. */
export async function logoutAction(formData: FormData): Promise<void> {
  const locale = String(formData.get("locale") ?? "he");
  const supabase = await createSupabaseServerClient();
  if (supabase) await signOut(supabase);
  redirect(`/${locale}/login`);
}
