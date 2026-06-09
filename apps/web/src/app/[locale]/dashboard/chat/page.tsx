import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getCurrentUser, getOrganizationMembers, getUserOrganizations } from "@platform/auth";
import { routing } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Chat, type ChatMessage } from "./chat";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

const HISTORY_LIMIT = 50;

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

export default async function ChatPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations("chat");

  // Login guard (same pattern as the rest of the dashboard).
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

  // Member directory (RLS members-only) — resolves sender names for live
  // messages whose payload only carries sender_id. Initial history + sends are
  // all read/written via the AUTHENTICATED client (never the secret key), so RLS
  // is the enforcer end to end.
  const members = await getOrganizationMembers(supabase, activeOrg.organizationId);
  const directory: Record<string, string> = {};
  for (const m of members) directory[m.userId] = m.displayName?.trim() || m.email;

  // Initial history: most recent HISTORY_LIMIT, shown oldest-at-top.
  const msgsRes = await supabase
    .from("messages")
    .select("id, sender_id, content, created_at")
    .eq("organization_id", activeOrg.organizationId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  const initialMessages: ChatMessage[] = (
    (msgsRes.data ?? []) as Array<{ id: string; sender_id: string; content: string; created_at: string }>
  )
    .map((m) => ({ id: m.id, senderId: m.sender_id, content: m.content, createdAt: m.created_at }))
    .reverse();

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <BackLink label={t("backToDashboard")} />

      <header className="mb-6">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {activeOrg.organizationName}
        </p>
        <h1 className="mt-1 text-balance text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      {organizations.length > 1 && (
        <nav className="mb-6 flex flex-wrap gap-2" aria-label={t("title")}>
          {organizations.map((org) => {
            const active = org.organizationId === activeOrg.organizationId;
            return (
              <Link
                key={org.organizationId}
                href={`/dashboard/chat?org=${org.organizationId}`}
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

      <Chat
        orgId={activeOrg.organizationId}
        currentUserId={user.id}
        locale={locale}
        directory={directory}
        initialMessages={initialMessages}
      />
    </main>
  );
}
