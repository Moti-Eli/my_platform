/**
 * Server wrapper. THE access boundary for this route: requireSession() is called
 * HERE, in this file, not in a layout and not in the proxy.
 *
 * Most drill-in keys resolve to the shared {@link ProfileSectionView} placeholder,
 * which reads the `[key]` segment itself with the `useParams` client hook. The
 * "organizations" key is the exception: it is a working org switcher, so this
 * server wrapper resolves the [key] up front, fetches the user's orgs through the
 * SAME RLS-scoped client (never the admin client), and hands them to a client
 * screen. Every other key falls through to the placeholder exactly as before.
 */
import { getUserOrganizations } from "@platform/auth";
import { requireSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ProfileSectionView } from "./ProfileSectionView";
import { OrganizationsScreen } from "./OrganizationsScreen";

export default async function ProfileSectionPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const session = await requireSession();
  const { key } = await params;

  if (key === "organizations") {
    // Same RLS-scoped client as profile/page.tsx — these are the caller's own
    // memberships, which the database already exposes to them; service_role would
    // only bypass that policy to re-answer it worse.
    const supabase = await createSupabaseServerClient();
    const orgs = supabase ? await getUserOrganizations(supabase, session.userId) : [];
    const mapped = orgs.map((org) => ({
      id: org.organizationId,
      name: org.organizationName,
      isAdmin: org.roles.some((r) => r.isAdmin),
    }));
    return <OrganizationsScreen orgs={mapped} activeOrgId={session.orgId} />;
  }

  return <ProfileSectionView />;
}
