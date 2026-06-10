import type { CSSProperties } from "react";
import { cookies } from "next/headers";
import { Frank_Ruhl_Libre } from "next/font/google";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { defaultTheme, themeNames, type ThemeName } from "@platform/config";
import { routing } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { LoginForm } from "./login-form";

// Same bilingual display face the landing page uses, so headlines feel
// intentional and consistent across both pages in he and en.
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

export default async function LoginPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("login");
  const tc = await getTranslations("common");

  // Theme cookie is read server-side so the toggle starts from the right state
  // and the first paint already matches (no flash) — same approach as the
  // landing page.
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get("theme")?.value;
  const initialTheme: ThemeName = themeNames.includes(themeCookie as ThemeName)
    ? (themeCookie as ThemeName)
    : defaultTheme;

  const appName = tc("appName");

  return (
    <div className={`${display.variable} relative flex min-h-screen flex-col`}>
      {/* Background atmosphere — the same grid + primary glow as the hero, so the
          login page reads as part of the same product. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div
          className="absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage: "radial-gradient(ellipse 70% 55% at 50% 0%, black, transparent)",
            WebkitMaskImage: "radial-gradient(ellipse 70% 55% at 50% 0%, black, transparent)",
          }}
        />
        <div className="absolute start-1/2 top-[-14rem] size-[40rem] -translate-x-1/2 rounded-full bg-primary/15 blur-[130px] rtl:translate-x-1/2" />
      </div>

      {/* Top bar — wordmark links home (a clear, always-available way back), with
          the language switcher + theme toggle, matching the landing top bar. */}
      <header className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-6">
        <Link
          href="/"
          style={displayFont}
          className="text-lg font-bold tracking-tight text-foreground transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-sm"
        >
          {appName}
        </Link>
        <div className="flex items-center gap-4">
          <LanguageSwitcher />
          <ThemeToggle initialTheme={initialTheme} />
        </div>
      </header>

      {/* Centered card */}
      <main className="flex flex-1 items-center justify-center px-6 py-10 sm:py-14">
        <div className="fade-rise w-full max-w-md">
          {/* Explicit "back to home" affordance, in addition to the wordmark. */}
          <Link
            href="/"
            className="group mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:text-foreground"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="size-4 transition-transform group-hover:-translate-x-0.5 rtl:rotate-180 rtl:group-hover:translate-x-0.5"
            >
              <path
                fillRule="evenodd"
                d="M12.79 5.23a.75.75 0 0 1 0 1.06L9.06 10l3.73 3.71a.75.75 0 1 1-1.06 1.06l-4.25-4.24a.75.75 0 0 1 0-1.06l4.25-4.24a.75.75 0 0 1 1.06 0Z"
                clipRule="evenodd"
              />
            </svg>
            {t("backToHome")}
          </Link>

          <div className="rounded-2xl border border-border bg-card/60 p-7 shadow-sm backdrop-blur sm:p-9">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-3 py-1 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground backdrop-blur">
              {t("eyebrow")}
            </span>
            <h1
              style={displayFont}
              className="mt-5 text-balance text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-4xl"
            >
              {t("title")}
            </h1>
            <p className="mt-2.5 text-pretty text-sm leading-relaxed text-muted-foreground">
              {t("subtitle")}
            </p>

            <div className="mt-8">
              <LoginForm locale={locale} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
