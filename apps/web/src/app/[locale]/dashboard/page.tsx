import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import {
  getCurrentUser,
  getEffectivePermissions,
  getUserOrganizations,
  isPlatformOwner,
} from "@platform/auth";
import type { Locale } from "@platform/i18n";
import { routing } from "@/i18n/routing";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DashboardView, type DashboardCapabilities } from "@/features/dashboard";
import { logoutAction } from "./actions";

/**
 * Dashboard route — thin shell (FEATURES.md): the same login gate as always,
 * plus server-side capability resolution (platform-owner flag, org membership,
 * union of effective permission keys across the user's organizations). The
 * view filters DASHBOARD_CARDS with those capabilities; every real destination
 * screen still enforces its own access — card visibility is UX only.
 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function DashboardPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Route protection: enforced here in the server component, not just in the
  // proxy. If there's no authenticated user, send them to login.
  const supabase = await createSupabaseServerClient();
  const user = supabase ? await getCurrentUser(supabase) : null;
  if (!supabase || !user) {
    redirect(`/${locale}/login`);
  }

  const [owner, organizations] = await Promise.all([
    isPlatformOwner(supabase),
    getUserOrganizations(supabase, user.id),
  ]);
  const permissionLists = await Promise.all(
    organizations.map((o) => getEffectivePermissions(supabase, user.id, o.organizationId))
  );

  const caps: DashboardCapabilities = {
    owner,
    hasOrganization: organizations.length > 0,
    permissions: new Set(permissionLists.flat()),
  };

  return (
    <DashboardView
      locale={locale as Locale}
      email={user.email}
      organizations={organizations}
      caps={caps}
      logoutAction={logoutAction}
    />
  );
}
