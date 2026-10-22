/**
 * Server wrapper for the edit-profile screen. THE access boundary for this
 * route: requireSession() is called HERE, as the first statement.
 *
 * Stage 1a edits the NAME only (the photo lands with stage 1b). The current
 * `public.users.display_name` is read through the RLS-scoped server client —
 * the caller's own row — and handed down as a prop, like profile/page.tsx.
 */
import { requireSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { EditProfileView } from "./EditProfileView";

export default async function EditProfilePage() {
  const { userId } = await requireSession();

  const supabase = await createSupabaseServerClient();
  let displayName = "";
  if (supabase) {
    const res = await supabase
      .from("users")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle();
    if (res.error) throw new Error(`EditProfilePage (users): ${res.error.message}`);
    displayName = (res.data as { display_name: string | null } | null)?.display_name ?? "";
  }

  return <EditProfileView displayName={displayName} />;
}
