import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getCurrentUser, isPlatformOwner } from "@platform/auth";
import { routing } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logoutAction } from "../dashboard/actions";
import { CreateOrg } from "./create-org";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

type Props = {
  params: Promise<{ locale: string }>;
};

interface OrgRow {
  id: string;
  name: string;
  createdAt: string;
  memberCount: number;
}

export default async function PlatformPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("platform");

  // --- Route protection -------------------------------------------------------
  // Must be authenticated AND a platform owner. The owner check is the boundary
  // (the nav link hiding is only UX). A non-owner is sent to their dashboard.
  const supabase = await createSupabaseServerClient();
  const user = supabase ? await getCurrentUser(supabase) : null;
  if (!supabase || !user) {
    redirect(`/${locale}/login`);
  }
  if (!(await isPlatformOwner(supabase))) {
    redirect(`/${locale}/dashboard`);
  }

  // --- All-orgs listing -------------------------------------------------------
  // RLS approach (b): the authenticated/publishable client CANNOT read every
  // org. So we read them with the service-role client — built ONLY here, AFTER
  // the owner check above has passed.
  const admin = createSupabaseAdminClient();
  let orgs: OrgRow[] = [];
  let loadState: "ok" | "notConfigured" | "error" = "ok";

  if (!admin) {
    loadState = "notConfigured";
  } else {
    const [orgsRes, memRes] = await Promise.all([
      admin.from("organizations").select("id, name, created_at").order("created_at", { ascending: true }),
      admin.from("memberships").select("organization_id"),
    ]);
    if (orgsRes.error || memRes.error) {
      loadState = "error";
    } else {
      const counts = new Map<string, number>();
      for (const m of (memRes.data ?? []) as Array<{ organization_id: string }>) {
        counts.set(m.organization_id, (counts.get(m.organization_id) ?? 0) + 1);
      }
      orgs = ((orgsRes.data ?? []) as Array<{ id: string; name: string; created_at: string }>).map(
        (o) => ({ id: o.id, name: o.name, createdAt: o.created_at, memberCount: counts.get(o.id) ?? 0 })
      );
    }
  }

  const totalMembers = orgs.reduce((sum, o) => sum + o.memberCount, 0);
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  return (
    <main className="relative mx-auto w-full max-w-4xl px-6 py-12">
      {/* Control-plane accent: a thin gradient rule that sets this area apart. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent opacity-60"
      />

      <div className="mb-8 flex items-center justify-between gap-4">
        <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="size-3.5">
            <path d="M10 1.5 3 4.5v4.2c0 4 2.8 7.7 7 8.8 4.2-1.1 7-4.8 7-8.8V4.5l-7-3Z" />
          </svg>
          {t("ownerBadge")}
        </span>
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {t("backToDashboard")}
          </Link>
          <form action={logoutAction}>
            <input type="hidden" name="locale" value={locale} />
            <button
              type="submit"
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted"
            >
              {t("logout")}
            </button>
          </form>
        </div>
      </div>

      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("eyebrow")}
          </p>
          <h1 className="mt-1 text-balance text-3xl font-bold tracking-tight text-foreground">
            {t("title")}
          </h1>
          <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <CreateOrg locale={locale} />
      </header>

      {/* Stat strip */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:max-w-md">
        <Stat label={t("statOrgs")} value={orgs.length} />
        <Stat label={t("statMembers")} value={totalMembers} />
      </div>

      {loadState === "notConfigured" ? (
        <Notice>{t("dataUnavailable")}</Notice>
      ) : loadState === "error" ? (
        <Notice>{t("loadError")}</Notice>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {orgs.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-muted-foreground">{t("noOrgs")}</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-5 py-3 text-start text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t("colOrg")}
                  </th>
                  <th className="px-5 py-3 text-start text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t("colMembers")}
                  </th>
                  <th className="px-5 py-3 text-end text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t("colCreated")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {orgs.map((org) => (
                  <tr
                    key={org.id}
                    className="border-b border-border transition-colors last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
                          {org.name.charAt(0).toUpperCase()}
                        </span>
                        <span className="truncate font-medium text-foreground">{org.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground">
                      {t("memberCount", { count: org.memberCount })}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-end tabular-nums text-muted-foreground">
                      {dateFormatter.format(new Date(org.createdAt))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4">
      <div className="text-3xl font-bold tabular-nums text-foreground">{value}</div>
      <div className="mt-0.5 text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-muted/40 px-6 py-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
