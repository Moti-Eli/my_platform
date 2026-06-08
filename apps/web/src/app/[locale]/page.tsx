import { cookies } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  defaultTheme,
  themeNames,
  type ThemeName,
} from "@platform/config";
import { routing } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

type Props = {
  params: Promise<{ locale: string }>;
};

/**
 * Server-side Supabase health check. Reads the globally-readable `permissions`
 * catalog with the publishable (anon) key — proving DB + RLS + client wiring
 * end to end. If env is missing it shows a graceful "not configured" state.
 */
async function SupabaseHealthCheck() {
  const t = await getTranslations("home");
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return <p className="text-muted-foreground">{t("healthNotConfigured")}</p>;
  }

  const { data, error } = await supabase
    .from("permissions")
    .select("key")
    .order("key");

  if (error) {
    return (
      <p className="text-muted-foreground">
        {t("healthError")} {error.message}
      </p>
    );
  }

  const rows = (data ?? []) as { key: string }[];
  if (rows.length === 0) {
    return <p className="text-muted-foreground">{t("healthEmpty")}</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-muted-foreground">{t("healthOk")}</p>
      <ul className="flex flex-wrap gap-2">
        {rows.map((row) => (
          <li
            key={row.key}
            className="rounded-lg border border-border bg-muted px-2.5 py-1 font-mono text-sm"
          >
            {row.key}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const tCommon = await getTranslations("common");
  const tHome = await getTranslations("home");
  const tLogin = await getTranslations("login");

  const cookieStore = await cookies();
  const themeCookie = cookieStore.get("theme")?.value;
  const initialTheme: ThemeName = themeNames.includes(themeCookie as ThemeName)
    ? (themeCookie as ThemeName)
    : defaultTheme;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-10 px-6 py-16">
      <header className="flex items-center justify-between gap-4">
        <LanguageSwitcher />
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
          >
            {tLogin("link")}
          </Link>
          <ThemeToggle initialTheme={initialTheme} />
        </div>
      </header>

      <div className="space-y-3">
        <h1 className="text-3xl font-bold text-foreground">
          {tCommon("appName")}
        </h1>
        <p className="text-muted-foreground">{tHome("tagline")}</p>
      </div>

      <section className="space-y-3 rounded-lg border border-border bg-card p-6 text-card-foreground">
        <h2 className="text-lg font-semibold">{tHome("healthTitle")}</h2>
        <SupabaseHealthCheck />
      </section>
    </main>
  );
}
