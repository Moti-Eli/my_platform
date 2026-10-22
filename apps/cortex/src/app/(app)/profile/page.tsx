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
 * The status tags ("tool manages, profile shows"): "owner" comes from the guard's
 * isAdmin; the shift positions come from the shifts tool's OWN read intent
 * (`shifts.list_my_positions`) through runIntent — never a direct read of the
 * tool's tables. Positions are decoration, so a failed read shows none rather than
 * failing the whole screen.
 */
import { requireSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@platform/auth";
import { buildCtx } from "@/cortex/build-ctx";
import { getServerRuntime } from "@/cortex/server-runtime";
import { ProfileView } from "./ProfileView";

export default async function ProfilePage() {
  const session = await requireSession();
  const { userId, orgId, isAdmin } = session;

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
  let orgName = "";
  if (supabase) {
    const userRes = await supabase
      .from("users")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle();
    if (userRes.error) throw new Error(`ProfilePage (users): ${userRes.error.message}`);
    displayName = (userRes.data as { display_name: string | null } | null)?.display_name ?? null;

    const orgRes = await supabase
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle();
    if (orgRes.error) throw new Error(`ProfilePage (organizations): ${orgRes.error.message}`);
    orgName = (orgRes.data as { name: string } | null)?.name ?? "";
  }

  let positions: string[] = [];
  try {
    const runtime = await getServerRuntime();
    const rows = await runtime.runIntent<Array<{ name: string }>>(
      "shifts.list_my_positions",
      {},
      buildCtx(session)
    );
    positions = rows.map((p) => p.name);
  } catch (err) {
    console.error("ProfilePage (shifts.list_my_positions) failed", err);
  }

  return (
    <ProfileView
      displayName={displayName}
      email={email}
      orgName={orgName}
      isAdmin={isAdmin}
      positions={positions}
    />
  );
}
