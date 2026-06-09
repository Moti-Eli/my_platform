import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getCurrentUser, getUserOrganizations, isPlatformOwner } from "@platform/auth";
import { routing } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logoutAction } from "./actions";

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

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <div className="flex items-center gap-3">
          {owner && (
            <Link
              href="/platform"
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/15"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="size-3.5">
                <path d="M10 1.5 3 4.5v4.2c0 4 2.8 7.7 7 8.8 4.2-1.1 7-4.8 7-8.8V4.5l-7-3Z" />
              </svg>
              {t("platformAdmin")}
            </Link>
          )}
          <Link
            href="/dashboard/chat"
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
          >
            {t("openChat")}
          </Link>
          <Link
            href="/dashboard/members"
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
          >
            {t("manageMembers")}
          </Link>
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
