import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  getCurrentUser,
  getOrganizationMembers,
  getUserOrganizations,
  hasPermission,
} from "@platform/auth";
import { routing } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RoleSelect } from "./role-select";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function RoleBadge({ isAdmin, label }: { isAdmin: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        isAdmin ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
      }`}
    >
      {label}
    </span>
  );
}

function BackLink({ label }: { label: string }) {
  return (
    <Link
      href="/dashboard"
      className="group mb-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="size-4 transition-transform group-hover:-translate-x-0.5 rtl:rotate-180"
      >
        <path
          fillRule="evenodd"
          d="M12.79 5.23a.75.75 0 0 1 0 1.06L9.06 10l3.73 3.71a.75.75 0 1 1-1.06 1.06l-4.25-4.24a.75.75 0 0 1 0-1.06l4.25-4.24a.75.75 0 0 1 1.06 0Z"
          clipRule="evenodd"
        />
      </svg>
      {label}
    </Link>
  );
}

export default async function MembersPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations("members");

  const supabase = await createSupabaseServerClient();
  const user = supabase ? await getCurrentUser(supabase) : null;
  if (!supabase || !user) {
    redirect(`/${locale}/login`);
  }

  const organizations = await getUserOrganizations(supabase, user.id);

  if (organizations.length === 0) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <BackLink label={t("backToDashboard")} />
        <p className="rounded-xl border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
          {t("noOrganization")}
        </p>
      </main>
    );
  }

  const requestedOrg = typeof sp.org === "string" ? sp.org : undefined;
  const activeOrg =
    organizations.find((org) => org.organizationId === requestedOrg) ?? organizations[0];

  const [canManage, members] = await Promise.all([
    hasPermission(supabase, user.id, activeOrg.organizationId, "members.manage"),
    getOrganizationMembers(supabase, activeOrg.organizationId),
  ]);

  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <BackLink label={t("backToDashboard")} />

      <header className="mb-8">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {activeOrg.organizationName}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-balance text-2xl font-bold text-foreground">{t("title")}</h1>
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {t("count", { count: members.length })}
          </span>
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      {organizations.length > 1 && (
        <nav className="mb-6 flex flex-wrap gap-2" aria-label={t("title")}>
          {organizations.map((org) => {
            const active = org.organizationId === activeOrg.organizationId;
            return (
              <Link
                key={org.organizationId}
                href={`/dashboard/members?org=${org.organizationId}`}
                className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {org.organizationName}
              </Link>
            );
          })}
        </nav>
      )}

      {!canManage && (
        <div className="mb-6 flex items-start gap-2.5 rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="mt-0.5 size-4 shrink-0"
          >
            <path
              fillRule="evenodd"
              d="M18 10A8 8 0 1 1 2 10a8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z"
              clipRule="evenodd"
            />
          </svg>
          <span>{t("readOnlyNotice")}</span>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {members.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-muted-foreground">{t("noMembers")}</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-5 py-3 text-start text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("colMember")}
                </th>
                <th className="px-5 py-3 text-start text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("colRole")}
                </th>
                <th className="px-5 py-3 text-end text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("colJoined")}
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const isAdmin = member.roles.some((role) => role.isAdmin);
                const displayName = member.displayName?.trim() || member.email;
                const initial = displayName.charAt(0).toUpperCase();
                const isSelf = member.userId === user.id;

                return (
                  <tr
                    key={member.membershipId}
                    className="border-b border-border transition-colors last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                          {initial}
                        </span>
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-medium text-foreground">
                              {displayName}
                            </span>
                            {isSelf && (
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                {t("you")}
                              </span>
                            )}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">{member.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      {canManage ? (
                        <RoleSelect
                          membershipId={member.membershipId}
                          orgId={activeOrg.organizationId}
                          currentRole={isAdmin ? "admin" : "member"}
                          locale={locale}
                        />
                      ) : (
                        <RoleBadge
                          isAdmin={isAdmin}
                          label={isAdmin ? t("roleAdmin") : t("roleMember")}
                        />
                      )}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-end tabular-nums text-muted-foreground">
                      {dateFormatter.format(new Date(member.joinedAt))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
