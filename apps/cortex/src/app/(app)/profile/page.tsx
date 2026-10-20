/**
 * Server wrapper. THE access boundary for this route: requireSession() is called
 * HERE, as the first statement, not in a layout and not in the proxy.
 *
 * Identity now travels DOWN AS PROPS (never a React context — session.ts's header
 * explains why): the profile screen shows the REAL signed-in user, so the page
 * resolves the display fields the guard doesn't carry — the auth email, the
 * `public.users.display_name`, and the active org's name — THROUGH THE SAME
 * RLS-SCOPED SERVER CLIENT (never the admin client), then hands them to ProfileView.
 *
 * The profile photo lives in the PRIVATE `avatars` bucket, so there is no
 * permanent link: when `avatar_path` is set we sign a short-lived URL here, with
 * the same RLS client (the storage policy lets the user read their own photo).
 * A failed signing just means no photo — the initial shows instead.
 */
import { requireSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@platform/auth";
import { ProfileView } from "./ProfileView";
import { AVATARS_BUCKET, AVATAR_URL_TTL } from "./avatar";

export default async function ProfilePage() {
  const { userId, orgId, isAdmin } = await requireSession();

  // The guard already ran through the RLS client; re-open it for the display-only
  // fields it doesn't return. Same RLS-scoped client — these are the caller's own
  // rows, which the database already exposes to them; service_role would only
  // bypass that policy to re-answer it worse. requireSession redirects when there
  // is no session, so `supabase` is present here in practice; the guard stays
  // defensive anyway.
  const supabase = await createSupabaseServerClient();
  const user = supabase ? await getCurrentUser(supabase) : null;
  const email = user?.email ?? "";

  let displayName: string | null = null;
  let avatarUrl: string | null = null;
  let orgName = "";
  if (supabase) {
    const userRes = await supabase
      .from("users")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle();
    if (userRes.error) throw new Error(`ProfilePage (users): ${userRes.error.message}`);
    displayName = (userRes.data as { display_name: string | null } | null)?.display_name ?? null;

    // A SEPARATE, non-fatal read: the deploy can land before 20261020000002 is
    // applied, and a missing column must cost the photo, not the whole screen.
    const avatarRes = await supabase
      .from("users")
      .select("avatar_path")
      .eq("id", userId)
      .maybeSingle();
    if (avatarRes.error) console.error("ProfilePage (avatar_path) failed", avatarRes.error.message);
    const avatarPath = (avatarRes.data as { avatar_path: string | null } | null)?.avatar_path ?? null;
    if (avatarPath) {
      const signed = await supabase.storage
        .from(AVATARS_BUCKET)
        .createSignedUrl(avatarPath, AVATAR_URL_TTL);
      if (signed.error) console.error("ProfilePage (avatar url) failed", signed.error.message);
      avatarUrl = signed.data?.signedUrl ?? null;
    }

    const orgRes = await supabase
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle();
    if (orgRes.error) throw new Error(`ProfilePage (organizations): ${orgRes.error.message}`);
    orgName = (orgRes.data as { name: string } | null)?.name ?? "";
  }

  return (
    <ProfileView
      displayName={displayName}
      email={email}
      orgName={orgName}
      isAdmin={isAdmin}
      userId={userId}
      avatarUrl={avatarUrl}
    />
  );
}
