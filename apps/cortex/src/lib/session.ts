// SERVER-ONLY. THE access boundary for every protected Cortex page.
import "server-only";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@platform/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The two halves of identity, and nothing else.
 *
 * Deliberately NOT the org name, the roles, or the client. A page that wants
 * more asks for more, explicitly; this is the minimum that makes a `Ctx`.
 */
export interface Session {
  userId: string;
  orgId: string;
  /** Whether the user holds an `is_admin` role in the ACTIVE org. The deliberate
   * "asks for more" this header describes — the shell reads it to gate admin-only
   * UI/intents. Derived, never a scoping key; RLS still enforces every access. */
  isAdmin: boolean;
}

/**
 * ============================================================================
 * THE GUARD. Every protected page calls this ITSELF, as its first statement.
 * ============================================================================
 * Not a layout, not the proxy. A layout does not reliably re-run on client-side
 * navigation, so a layout guard fires once and is then trusted for the rest of
 * the session — the same failure as trusting the proxy, wearing a different hat.
 * `src/proxy.ts` refreshes tokens and protects NOTHING.
 *
 * Identity travels from here to client components as PROPS, one level, from the
 * server wrapper that called this. It is deliberately never put in a React
 * context: a context is somewhere identity can be read from without a guard
 * having run above it, which is precisely the hole this shape exists to close.
 *
 * WHICH PAGES CALL IT — the whole surface, one line each:
 *   app/page.tsx                    -> requireSession() (Home; passes ids to HomeView)
 *   app/catalog/page.tsx            -> requireSession()
 *   app/comms/page.tsx              -> requireSession()
 *   app/notifications/page.tsx      -> requireSession()
 *   app/profile/page.tsx            -> requireSession()
 *   app/profile/s/[key]/page.tsx    -> requireSession()
 *   app/settings/page.tsx           -> requireSession()
 *   app/settings/appearance/page.tsx-> requireSession()
 *   app/settings/language/page.tsx  -> requireSession()
 *   app/settings/version/page.tsx   -> requireSession()
 *   app/tools/inventory/page.tsx    -> requireSession() (passes ids to FullScreen)
 *   app/tools/[appId]/page.tsx      -> requireSession()
 *   app/login/page.tsx              -> NONE. Public by definition: it is how you
 *                                      get a session. Guarding it is a redirect loop.
 *   app/layout.tsx                  -> not a page; renders chrome only and reads
 *                                      no identity. See its note.
 */
export async function requireSession(): Promise<Session> {
  // (a) Identity, through the RLS-scoped server client.
  const supabase = await createSupabaseServerClient();
  const user = supabase ? await getCurrentUser(supabase) : null;
  if (!supabase || !user) {
    redirect("/login");
  }

  // (b) Active organizations, through the SAME RLS-scoped client. Never the
  //     admin client: this question is "which orgs may THIS caller act in", and
  //     the database already answers it correctly for the caller. Reaching for
  //     service_role here would bypass the very policy that makes the answer
  //     true, to re-implement it by hand, worse.
  //
  //     WHAT RLS ALREADY GUARANTEES — the memberships SELECT policy is:
  //         deleted_at is null
  //         AND private.org_is_active(organization_id)
  //         AND (user_id = auth.uid() OR private.auth_user_is_member_of(organization_id))
  //     So soft-deleted memberships and soft-deleted organizations are ALREADY
  //     excluded, exactly as private.auth_user_is_member_of would. We rely on
  //     that rather than re-filtering it here.
  //
  //     WHAT IT DOES NOT GUARANTEE, AND WHY `.eq("user_id")` IS LOAD-BEARING —
  //     look at the trailing OR: the policy also exposes CO-MEMBERS' membership
  //     rows in orgs you belong to. That is correct for a member list, and wrong
  //     here. Without the filter, "first by created_at" could return a colleague's
  //     membership and hand this session the wrong org. RLS does not restrict to
  //     the caller's own rows; this line does.
  const res = await supabase
    .from("memberships")
    .select("id, organization_id, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (res.error) {
    throw new Error(`requireSession (memberships): ${res.error.message}`);
  }
  const memberships = (res.data ?? []) as Array<{
    id: string;
    organization_id: string;
    created_at: string;
  }>;

  // (c) Zero memberships -> an explicit, translated state. NOT an empty dashboard.
  //     Unreachable today: there is no self-service signup, so every account is
  //     provisioned WITH a membership (by add-member or createOrganization). It
  //     becomes reachable the day signup exists, and a blank screen then would
  //     read as a bug rather than as the accurate statement "you are in no org".
  //     Handled by redirecting to a page that says so.
  if (memberships.length === 0) {
    redirect("/no-organization");
  }

  // (d)/(e) One membership -> that is the active org.
  //         More than one -> the earliest by created_at, deterministically.
  //
  //         TODO(org-picker): this is a DELIBERATE DEFERRAL, not an oversight. A
  //         user can genuinely belong to many organizations (the schema is built
  //         for it: memberships is a join table, and roles are per-org precisely
  //         so the same person can be an admin in one org and a member in
  //         another). The shell will need a switcher, and "the active org" will
  //         then come from the user's choice — probably a cookie, the way locale
  //         and theme already do — with this ordering as the first-visit default.
  //         Until that exists, picking the first is the only honest option: it is
  //         stable across requests, which a picker-less UI needs. It is NOT a
  //         claim that the first org is the right one.
  const active = memberships[0]!;

  // (f) Admin status in the ACTIVE org. This is the "a page that wants more asks
  //     for more, explicitly" the Session header promises — a deliberate second
  //     question, not scope creep: every page now wants to know whether the caller
  //     is an admin here, so the shell can gate admin-only UI/intents.
  //
  //     Same RLS-scoped client, NEVER the admin client — the DB already answers
  //     "may THIS caller see these role rows" correctly, and service_role would
  //     only bypass the policy to re-implement it worse. Scoped to `active.id` (the
  //     membership row for the active org), so the roles considered are exactly the
  //     ones held IN that org. `!inner` + the embedded `roles.is_admin` filter make
  //     this "does any is_admin role hang off this membership".
  //
  //     FAILS CLOSED: a query error throws (like the memberships query above); it
  //     never defaults to true. Zero matching rows -> not an admin (false).
  const adminRes = await supabase
    .from("membership_roles")
    .select("membership_id, roles!inner(is_admin)")
    .eq("membership_id", active.id)
    .eq("roles.is_admin", true)
    .limit(1);

  if (adminRes.error) {
    throw new Error(`requireSession (admin role): ${adminRes.error.message}`);
  }
  const isAdmin = (adminRes.data ?? []).length > 0;

  return { userId: user.id, orgId: active.organization_id, isAdmin };
}
