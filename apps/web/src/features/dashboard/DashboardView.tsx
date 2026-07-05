/**
 * Dashboard — the existing dashboard restyled with the Home shell's design
 * (calm/airy token-driven cards, geometric glyphs, coming-soon treatment,
 * responsive dock/rail). Behavior is unchanged: logout uses the same server
 * action, real cards navigate to the existing chat / members / platform
 * screens (each still enforcing its own access server-side), and the
 * signed-in-as + organizations/roles info is still shown.
 *
 * The card list is DASHBOARD_CARDS filtered by capabilities resolved once in
 * the page shell — same code for everyone; role only changes which cards
 * survive. Placeholder cards (schedule, tasks) float a "coming soon" toast.
 */
import { getTranslations } from "next-intl/server";
import { colors } from "@platform/config";
import type { UserOrganization } from "@platform/auth";
import type { Locale } from "@platform/i18n";
import { Link } from "@/i18n/navigation";
import {
  DASHBOARD_CARDS,
  filterDashboardCards,
  type CardTone,
  type DashboardCapabilities,
} from "./cards";
import { Glyph, type GlyphName } from "./glyphs";
import { Soon, SoonProvider } from "./soon";

/**
 * Accent tone → CSS color. Semantic slots use the theme variables (adapt to
 * light/dark automatically); success/warning have no semantic slot yet, so
 * they read straight from the shared scale (legible on both themes). "owner"
 * is ink — the foreground variable — so it stays premium-neutral in any theme.
 */
function toneColor(tone: CardTone): string {
  switch (tone) {
    case "primary":
      return "var(--primary)";
    case "success":
      return colors.success[500];
    case "warning":
      return colors.warning[500];
    case "owner":
      return "var(--foreground)";
  }
}

function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

const TABS: { id: string; labelKey: string; glyph: GlyphName }[] = [
  { id: "home", labelKey: "tabHome", glyph: "home" },
  { id: "schedule", labelKey: "tabSchedule", glyph: "dots" },
  { id: "tasks", labelKey: "tabTasks", glyph: "bars" },
  { id: "chat", labelKey: "tabChat", glyph: "chat" },
  { id: "profile", labelKey: "tabProfile", glyph: "profile" },
];
const ACTIVE_TAB = "home";

const CARD_CLASS =
  "fade-rise group block w-full rounded-2xl bg-card p-5 text-start shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md sm:p-6";

interface DashboardViewProps {
  locale: Locale;
  email: string | undefined;
  organizations: UserOrganization[];
  caps: DashboardCapabilities;
  /** The existing logout server action (apps/web dashboard/actions.ts). */
  logoutAction: (formData: FormData) => Promise<void>;
}

export async function DashboardView({
  locale,
  email,
  organizations,
  caps,
  logoutAction,
}: DashboardViewProps) {
  const t = await getTranslations(); // root: cards use dotted keys across namespaces
  const tDash = await getTranslations("dashboard");
  const tHome = await getTranslations("home");
  const tCommon = await getTranslations("common");

  const cards = filterDashboardCards(DASHBOARD_CARDS, caps);
  const initial = (email?.trim()[0] ?? "?").toUpperCase();
  const today = new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());

  return (
    <SoonProvider label={tCommon("comingSoon")}>
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <Soon
              aria-label={tHome("drawerTitle")}
              className="grid size-10 place-items-center rounded-full text-foreground transition-colors hover:bg-muted"
            >
              <Glyph name="menu" className="size-5" />
            </Soon>
            <span className="text-base font-bold tracking-wide text-foreground">
              {tCommon("appName")}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Logout — the same server action + hidden locale the dashboard always used. */}
            <form action={logoutAction}>
              <input type="hidden" name="locale" value={locale} />
              <button
                type="submit"
                className="flex h-10 items-center rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {tDash("logout")}
              </button>
            </form>
            <Soon
              aria-label={tHome("tabProfile")}
              className="grid size-10 place-items-center rounded-full bg-primary/10 font-semibold text-primary transition-transform hover:scale-105"
            >
              {initial}
            </Soon>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-32 pt-8 sm:px-6 sm:pt-12 lg:pb-16">
        {/* Heading */}
        <section className="fade-rise">
          <p className="text-sm font-medium text-primary">{today}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {tDash("title")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {tDash("signedInAs")}:{" "}
            <span className="font-medium text-foreground">{email}</span>
          </p>
        </section>

        {/* Organizations + roles (same info the dashboard always showed) */}
        <section className="fade-rise mt-5" style={{ animationDelay: "60ms" }}>
          {organizations.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tDash("noOrganizations")}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {organizations.map((org) => (
                <span
                  key={org.organizationId}
                  className="inline-flex max-w-full items-baseline gap-1.5 rounded-full bg-card px-3.5 py-1.5 text-sm shadow-sm"
                >
                  <span className="truncate font-semibold text-card-foreground">
                    {org.organizationName}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {org.roles.length > 0
                      ? org.roles.map((role) => role.name).join(", ")
                      : tDash("noRoles")}
                  </span>
                </span>
              ))}
            </div>
          )}
        </section>

        {/* Registry-driven cards: real destinations navigate, placeholders toast */}
        <div className="mt-8 flex flex-col gap-4 sm:gap-5">
          {cards.map((card, i) => {
            const tone = toneColor(card.tone);
            const delay = { animationDelay: `${120 + i * 70}ms` };
            const body = (
              <>
                <div className="flex items-start gap-4">
                  <span
                    className="grid size-12 shrink-0 place-items-center rounded-2xl transition-transform duration-200 group-hover:scale-105"
                    style={{ backgroundColor: tint(tone, 12), color: tone }}
                  >
                    <Glyph name={card.glyph} className="size-6" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h2 className="text-base font-semibold text-card-foreground sm:text-lg">
                        {t(card.titleKey)}
                      </h2>
                      {card.badgeKey ? (
                        <span
                          className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                          style={{ backgroundColor: tint(tone, 12), color: tone }}
                        >
                          {t(card.badgeKey)}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {t(card.descKey)}
                    </p>
                  </div>
                  {card.href ? (
                    <span
                      className="mt-1 shrink-0 self-center text-muted-foreground transition-all duration-200 group-hover:translate-x-1 group-hover:text-foreground rtl:group-hover:-translate-x-1"
                      aria-hidden
                    >
                      <Glyph name="arrow" className="size-5 rtl:-scale-x-100" />
                    </span>
                  ) : null}
                </div>

                {!card.href ? (
                  <div className="mt-5 flex items-center gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="h-2 w-3/5 animate-pulse rounded-full bg-muted" />
                      <div className="h-2 w-2/5 animate-pulse rounded-full bg-muted [animation-delay:400ms]" />
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
                      <span
                        className="size-1.5 animate-pulse rounded-full"
                        style={{ backgroundColor: tone }}
                      />
                      {tCommon("comingSoon")}
                    </span>
                  </div>
                ) : null}
              </>
            );

            return card.href ? (
              <Link key={card.id} href={card.href} className={CARD_CLASS} style={delay}>
                {body}
              </Link>
            ) : (
              <Soon key={card.id} className={CARD_CLASS} style={delay} aria-label={t(card.titleKey)}>
                {body}
              </Soon>
            );
          })}
        </div>
      </main>

      {/* Bottom dock (phones/tablets) */}
      <nav className="fixed inset-x-4 bottom-4 z-20 lg:hidden">
        <div className="mx-auto flex max-w-md items-stretch justify-between rounded-full bg-card px-3 py-2 shadow-lg">
          {TABS.map((tab) => {
            const active = tab.id === ACTIVE_TAB;
            return (
              <Soon
                key={tab.id}
                aria-label={tHome(tab.labelKey)}
                className={`flex min-w-12 flex-col items-center gap-0.5 rounded-full px-2 py-1 text-xs transition-colors ${
                  active ? "font-semibold text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span
                  className={`grid h-6 w-9 place-items-center rounded-full ${active ? "bg-primary/10" : ""}`}
                >
                  <Glyph name={tab.glyph} className="size-4.5" />
                </span>
                {tHome(tab.labelKey)}
              </Soon>
            );
          })}
        </div>
      </nav>

      {/* Side rail (desktop) */}
      <nav className="fixed start-6 top-1/2 z-20 hidden -translate-y-1/2 flex-col gap-1 rounded-full bg-card p-2 shadow-lg lg:flex">
        {TABS.map((tab) => {
          const active = tab.id === ACTIVE_TAB;
          return (
            <Soon
              key={tab.id}
              title={tHome(tab.labelKey)}
              aria-label={tHome(tab.labelKey)}
              className={`grid size-11 place-items-center rounded-full transition-colors ${
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Glyph name={tab.glyph} className="size-5" />
            </Soon>
          );
        })}
      </nav>
    </SoonProvider>
  );
}
