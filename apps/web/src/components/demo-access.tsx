import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

// ============================================================================
// DEMO ACCESS — TEMPORARY. EVALUATION ONLY.
// ----------------------------------------------------------------------------
// This section lists the SEEDED demo credentials so evaluators can sign in. It is
// SAFE BY DEFAULT: it is NEVER rendered in a production build unless the deploy
// explicitly opts in (see `isDemoAccessEnabled`). It is also self-contained — to
// drop it entirely, delete this file and its single usage in the landing page.
//
// The credentials below are intentionally weak demo accounts for evaluation
// deploys that hold NO real data. They must never be exposed on a real production
// site — which the env gate guarantees.
// ============================================================================

/**
 * Whether the demo-access section may be shown. Safe by default: in a production
 * build it is shown ONLY when `NEXT_PUBLIC_SHOW_DEMO_ACCESS=1` is set at build
 * time (intended for a dedicated EVALUATION deploy with no real data). In
 * development it is shown automatically. So a real production deploy that doesn't
 * set the flag can never leak these credentials.
 */
export function isDemoAccessEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_SHOW_DEMO_ACCESS === "1" ||
    process.env.NODE_ENV !== "production"
  );
}

const DEMO_PASSWORD = "123456";

const ACCOUNTS = {
  owner: "owner@platform.test",
  orgA: {
    admins: ["admin1@organizationA.com", "admin2@organizationA.com"],
    members: ["user1@organizationA.com", "user2@organizationA.com", "user3@organizationA.com"],
  },
  orgB: {
    admins: ["admin1@organizationB.com", "admin2@organizationB.com"],
    members: ["user1@organizationB.com", "user2@organizationB.com", "user3@organizationB.com"],
  },
} as const;

function Email({ children }: { children: string }) {
  return (
    <li>
      <code dir="ltr" className="block truncate rounded-md bg-muted/60 px-2.5 py-1.5 font-mono text-xs text-foreground">
        {children}
      </code>
    </li>
  );
}

function OrgColumn({
  label,
  admins,
  members,
  adminsLabel,
  membersLabel,
}: {
  label: string;
  admins: readonly string[];
  members: readonly string[];
  adminsLabel: string;
  membersLabel: string;
}) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-foreground">{label}</h4>
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{adminsLabel}</p>
        <ul className="space-y-1.5">
          {admins.map((e) => (
            <Email key={e}>{e}</Email>
          ))}
        </ul>
      </div>
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{membersLabel}</p>
        <ul className="space-y-1.5">
          {members.map((e) => (
            <Email key={e}>{e}</Email>
          ))}
        </ul>
      </div>
    </div>
  );
}

export async function DemoAccess() {
  // Defense in depth: even if a caller forgets to gate the usage, never render the
  // credentials unless explicitly enabled.
  if (!isDemoAccessEnabled()) return null;

  const t = await getTranslations("landing.demo");

  return (
    <section
      aria-labelledby="demo-title"
      className="relative overflow-hidden rounded-3xl border-2 border-dashed border-primary/30 bg-card/60 p-7 sm:p-9"
    >
      {/* subtle "demo" corner tint */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -end-16 -top-16 size-48 rounded-full bg-primary/10 blur-3xl"
      />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">{t("kicker")}</p>
          <h3 id="demo-title" className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {t("title")}
          </h3>
          <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="rounded-xl border border-border bg-background px-4 py-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("passwordLabel")}
          </p>
          <code dir="ltr" className="font-mono text-base font-semibold text-foreground">
            {DEMO_PASSWORD}
          </code>
        </div>
      </div>

      <div className="mt-7 grid gap-7 sm:grid-cols-3">
        {/* Platform owner */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground">{t("owner")}</h4>
          <ul className="space-y-1.5">
            <Email>{ACCOUNTS.owner}</Email>
          </ul>
          <p className="text-xs leading-relaxed text-muted-foreground">{t("ownerNote")}</p>
        </div>

        <OrgColumn
          label={t("orgA")}
          admins={ACCOUNTS.orgA.admins}
          members={ACCOUNTS.orgA.members}
          adminsLabel={t("admins")}
          membersLabel={t("members")}
        />
        <OrgColumn
          label={t("orgB")}
          admins={ACCOUNTS.orgB.admins}
          members={ACCOUNTS.orgB.members}
          adminsLabel={t("admins")}
          membersLabel={t("members")}
        />
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="size-4 shrink-0 text-primary">
            <path
              fillRule="evenodd"
              d="M18 10A8 8 0 1 1 2 10a8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z"
              clipRule="evenodd"
            />
          </svg>
          {t("note")}
        </p>
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.98]"
        >
          {t("cta")}
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="size-4 rtl:rotate-180">
            <path
              fillRule="evenodd"
              d="M7.21 14.77a.75.75 0 0 1 0-1.06L10.94 10 7.21 6.29a.75.75 0 1 1 1.06-1.06l4.25 4.24a.75.75 0 0 1 0 1.06l-4.25 4.24a.75.75 0 0 1-1.06 0Z"
              clipRule="evenodd"
            />
          </svg>
        </Link>
      </div>
    </section>
  );
}
