import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getCurrentUser, getUserOrganizations } from "@platform/auth";
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

  const organizations = await getUserOrganizations(supabase, user.id);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <div className="flex items-center gap-3">
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
