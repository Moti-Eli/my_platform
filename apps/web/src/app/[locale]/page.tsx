import type { CSSProperties } from "react";
import { cookies } from "next/headers";
import { Frank_Ruhl_Libre } from "next/font/google";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { defaultTheme, themeNames, type ThemeName } from "@platform/config";
import { captureException } from "@platform/observability";
import { routing } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { DemoAccess, isDemoAccessEnabled } from "@/components/demo-access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Distinctive bilingual display face — a renowned Hebrew serif that also covers
// Latin, so headlines feel intentional in both he and en. Body stays on the
// token --font-sans.
const display = Frank_Ruhl_Libre({
  subsets: ["latin", "hebrew"],
  weight: ["500", "700", "900"],
  variable: "--font-display",
  display: "swap",
});
const displayFont: CSSProperties = { fontFamily: "var(--font-display)" };

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

type Props = {
  params: Promise<{ locale: string }>;
};

// ---------------------------------------------------------------------------
// Subtle system-status pill — replaces the old raw permission dump. It only
// checks reachability (HEAD/count, no data) and shows a calm indicator.
// ---------------------------------------------------------------------------
function StatusPill({ tone, label }: { tone: "ok" | "down" | "muted"; label: string }) {
  const dot = tone === "ok" ? "bg-emerald-500" : tone === "down" ? "bg-destructive" : "bg-muted-foreground";
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
      <span className="relative flex size-2">
        {tone === "ok" && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/60" />
        )}
        <span className={`relative inline-flex size-2 rounded-full ${dot}`} />
      </span>
      {label}
    </span>
  );
}

async function SystemStatus() {
  const t = await getTranslations("landing.status");
  const supabase = await createSupabaseServerClient();
  if (!supabase) return <StatusPill tone="muted" label={t("notConfigured")} />;
  // HEAD + count: confirms DB + RLS + wiring without returning any rows/data.
  const { error } = await supabase.from("permissions").select("*", { head: true, count: "exact" });
  if (error) {
    captureException(error, { source: "landingSystemStatus" });
    return <StatusPill tone="down" label={t("down")} />;
  }
  return <StatusPill tone="ok" label={t("operational")} />;
}

function Section({
  num,
  title,
  lead,
  points,
}: {
  num: string;
  title: string;
  lead: string;
  points: string[];
}) {
  return (
    <section className="grid gap-x-14 gap-y-7 border-t border-border py-14 md:grid-cols-[minmax(0,19rem)_1fr] md:py-20">
      <div className="md:sticky md:top-14 md:self-start">
        <span className="font-mono text-sm text-primary">{num}</span>
        <h2
          style={displayFont}
          className="mt-3 text-balance text-3xl font-bold leading-tight text-foreground sm:text-4xl"
        >
          {title}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{lead}</p>
      </div>
      <ul className="space-y-5">
        {points.map((p) => (
          <li key={p} className="flex gap-4">
            <span aria-hidden="true" className="mt-3 h-px w-6 shrink-0 bg-primary/50" />
            <span className="text-pretty text-[15px] leading-relaxed text-foreground/80">{p}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const tc = await getTranslations("common");
  const t = await getTranslations("landing");

  const cookieStore = await cookies();
  const themeCookie = cookieStore.get("theme")?.value;
  const initialTheme: ThemeName = themeNames.includes(themeCookie as ThemeName)
    ? (themeCookie as ThemeName)
    : defaultTheme;

  const appName = tc("appName");
  const showDemo = isDemoAccessEnabled();

  const sections = [
    { key: "whatIs", num: t("whatIs.num"), title: t("whatIs.title"), lead: t("whatIs.lead"), points: t.raw("whatIs.points") as string[] },
    { key: "architecture", num: t("architecture.num"), title: t("architecture.title"), lead: t("architecture.lead"), points: t.raw("architecture.points") as string[] },
    { key: "security", num: t("security.num"), title: t("security.title"), lead: t("security.lead"), points: t.raw("security.points") as string[] },
    { key: "why", num: t("why.num"), title: t("why.title"), lead: t("why.lead"), points: t.raw("why.points") as string[] },
  ];

  return (
    <div className={`${display.variable} min-h-screen`}>
      {/* ============================ HERO ============================ */}
      <header className="relative overflow-hidden">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
          <div
            className="absolute inset-0 opacity-50"
            style={{
              backgroundImage:
                "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
              backgroundSize: "56px 56px",
              maskImage: "radial-gradient(ellipse 75% 55% at 50% 0%, black, transparent)",
              WebkitMaskImage: "radial-gradient(ellipse 75% 55% at 50% 0%, black, transparent)",
            }}
          />
          <div className="absolute start-1/2 top-[-12rem] size-[42rem] -translate-x-1/2 rounded-full bg-primary/15 blur-[130px] rtl:translate-x-1/2" />
        </div>

        {/* top bar */}
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-6">
          <span style={displayFont} className="text-lg font-bold tracking-tight text-foreground">
            {appName}
          </span>
          <div className="flex items-center gap-4">
            <LanguageSwitcher />
            <ThemeToggle initialTheme={initialTheme} />
            <Link
              href="/login"
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted"
            >
              {t("signIn")}
            </Link>
          </div>
        </div>

        {/* hero content */}
        <div className="mx-auto max-w-6xl px-6 pb-16 pt-10 sm:pb-24 sm:pt-16">
          <div className="fade-rise max-w-3xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-3 py-1 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground backdrop-blur">
              {t("eyebrow")}
            </span>
            <h1
              style={displayFont}
              className="mt-6 text-balance text-[2.6rem] font-black leading-[1.05] tracking-tight text-foreground sm:text-6xl"
            >
              {t("headline")}
            </h1>
            <p className="mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">
              {t("subhead")}
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.98]"
              >
                {t("ctaExplore")}
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="size-4 rtl:rotate-180">
                  <path
                    fillRule="evenodd"
                    d="M7.21 14.77a.75.75 0 0 1 0-1.06L10.94 10 7.21 6.29a.75.75 0 1 1 1.06-1.06l4.25 4.24a.75.75 0 0 1 0 1.06l-4.25 4.24a.75.75 0 0 1-1.06 0Z"
                    clipRule="evenodd"
                  />
                </svg>
              </Link>
              {showDemo && (
                <a
                  href="#demo"
                  className="rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  {t("ctaDemo")}
                </a>
              )}
              <span className="ms-1">
                <SystemStatus />
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* ========================== SECTIONS ========================== */}
      <main className="mx-auto max-w-6xl px-6">
        {sections.map((s) => (
          <Section key={s.key} num={s.num} title={s.title} lead={s.lead} points={s.points} />
        ))}

        {/* DEMO — safe by default: only shown when demo access is enabled (dev, or
            a deploy that opts in via NEXT_PUBLIC_SHOW_DEMO_ACCESS=1). Self-contained:
            remove this block + the component to drop it entirely. */}
        {showDemo && (
          <section id="demo" className="scroll-mt-8 border-t border-border py-14 md:py-20">
            <DemoAccess />
          </section>
        )}
      </main>

      {/* =========================== FOOTER =========================== */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-6 py-8">
          <span style={displayFont} className="text-sm font-bold text-foreground">
            {appName}
          </span>
          <p className="text-xs text-muted-foreground">{t("footer")}</p>
        </div>
      </footer>
    </div>
  );
}
