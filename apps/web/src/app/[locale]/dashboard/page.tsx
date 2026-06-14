import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getCurrentUser, getUserOrganizations, isPlatformOwner } from "@platform/auth";
import { FEATURES, type FeatureDefinition } from "@platform/core";
import { routing } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logoutAction } from "./actions";

// Web presentation for each registry feature. The registry owns existence /
// visibility / label / route; the app owns how the link LOOKS and its order
// (FEATURES.md §4). `order` preserves the pre-registry nav (Platform, Chat,
// Members); the platform link keeps its distinct "control-plane" styling.
const SHIELD_ICON = (
  <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="size-3.5">
    <path d="M10 1.5 3 4.5v4.2c0 4 2.8 7.7 7 8.8 4.2-1.1 7-4.8 7-8.8V4.5l-7-3Z" />
  </svg>
);
const NEUTRAL_LINK = "rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted";
const NAV_PRESENTATION: Record<string, { order: number; className: string; icon?: ReactNode }> = {
  platform: {
    order: 0,
    className:
      "inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/15",
    icon: SHIELD_ICON,
  },
  chat: { order: 1, className: NEUTRAL_LINK },
  members: { order: 2, className: NEUTRAL_LINK },
};
const DEFAULT_NAV_PRESENTATION = { order: 50, className: NEUTRAL_LINK } as const;

/**
 * Same visibility check the nav has always used: owner-only features need
 * platform ownership; every other feature needs organization membership. (No
 * current feature sets `requiredPermission`; the nav never consulted permissions,
 * so this preserves behavior exactly. Wire permission-gated nav visibility when
 * the first such feature lands.)
 */
function isNavVisible(
  f: FeatureDefinition,
  opts: { owner: boolean; hasOrganization: boolean }
): boolean {
  if (!f.enabled || !f.platforms.includes("web")) return false;
  return f.ownerOnly ? opts.owner : opts.hasOrganization;
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function DashboardPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("dashboard");

  // Route protection: enforced here in the server component, not just in the
  // proxy. If there's no authenticated user, send them to login.
  const supabase = await createSupabaseServerClient();
  const user = supabase ? await getCurrentUser(supabase) : null;
  if (!supabase || !user) {
    redirect(`/${locale}/login`);
  }

  const [organizations, owner] = await Promise.all([
    getUserOrganizations(supabase, user.id),
    isPlatformOwner(supabase),
  ]);

  // Org-scoped links (chat, members) only make sense for users who actually
  // belong to an organization. A platform owner with no membership, for example,
  // sees only the platform-admin link, not these.
  const hasOrganization = organizations.length > 0;

  // Registry-driven nav: the link set + per-role visibility + labels all derive
  // from FEATURES now (previously hardcoded). `tNav` resolves the dotted labelKey.
  const tNav = await getTranslations();
  const navFeatures = FEATURES.filter((f) => isNavVisible(f, { owner, hasOrganization }))
    .map((f) => ({ feature: f, ui: NAV_PRESENTATION[f.id] ?? DEFAULT_NAV_PRESENTATION }))
    .sort((a, b) => a.ui.order - b.ui.order);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <div className="flex items-center gap-3">
          {navFeatures.map(({ feature, ui }) => (
            <Link key={feature.id} href={`/${feature.route}`} className={ui.className}>
              {ui.icon}
              {tNav(feature.labelKey)}
            </Link>
          ))}
          <form action={logoutAction}>
            <input type="hidden" name="locale" value={locale} />
            <button
              type="submit"
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
            >
              {t("logout")}
            </button>
          </form>
        </div>
      </header>

      <p className="text-muted-foreground">
        {t("signedInAs")}: <span className="font-medium text-foreground">{user.email}</span>
      </p>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">{t("organizations")}</h2>
        {organizations.length === 0 ? (
          <p className="text-muted-foreground">{t("noOrganizations")}</p>
        ) : (
          <ul className="space-y-3">
            {organizations.map((org) => (
              <li
                key={org.organizationId}
                className="rounded-lg border border-border bg-card p-4 text-card-foreground"
              >
                <div className="font-semibold">{org.organizationName}</div>
                <div className="text-sm text-muted-foreground">
                  {t("roles")}:{" "}
                  {org.roles.length > 0
                    ? org.roles.map((role) => role.name).join(", ")
                    : t("noRoles")}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
