import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import {
  baseStylesheet,
  themeStylesheet,
  brandColor,
  defaultTheme,
  isThemeName,
} from "@/design-system";
import { getDirection, defaultLocale, isLocale, I18nProvider } from "@/i18n";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { LANG_COOKIE, THEME_COOKIE, migrateLegacyTheme } from "@/lib/cookies";
import { ServiceWorkerRegister } from "@/components/pwa/ServiceWorkerRegister";
import { QueryProvider } from "@/lib/query/QueryProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cortex",
  description: "Cortex — סופר-אפליקציה לניהול העסק שלך.",
  applicationName: "Cortex",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Cortex",
    statusBarStyle: "default",
  },
  icons: {
    icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/icon.svg" }],
  },
};

export const viewport: Viewport = {
  themeColor: brandColor,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * The DOCUMENT shell, and nothing more: html/body, dir + lang, the design-system
 * stylesheet, and the locale/theme providers every screen needs.
 *
 * IT DOES NOT MOUNT AppShell. Chrome (header, app tabs, bottom nav, AI button)
 * belongs to `(app)/layout.tsx`, because the auth screens must NOT have it — a
 * login form wrapped in a shell full of tools you cannot use yet is both wrong
 * and unusable. Route groups make that split without touching a single URL.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  // Language + theme come from cookies so the first server paint is already
  // correct (no flash / hydration mismatch); the client providers take over for
  // live switching. Defaults apply when a cookie is absent or unrecognized.
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get(LANG_COOKIE)?.value;
  const locale = isLocale(localeCookie) ? localeCookie : defaultLocale;
  // Map any legacy "light"/"dark" cookie to its new key before narrowing.
  const themeCookie = migrateLegacyTheme(cookieStore.get(THEME_COOKIE)?.value);
  const theme = isThemeName(themeCookie) ? themeCookie : defaultTheme;
  const dir = getDirection(locale);

  return (
    <html lang={locale} dir={dir} data-theme={theme}>
      <body className="min-h-dvh antialiased">
        {/* Design-system tokens: structural (:root) + per-theme ([data-theme]). */}
        <style
          dangerouslySetInnerHTML={{ __html: baseStylesheet() + "\n" + themeStylesheet() }}
        />
        <ServiceWorkerRegister />
        <QueryProvider>
          <I18nProvider initialLocale={locale}>
            <ThemeProvider initialTheme={theme}>{children}</ThemeProvider>
          </I18nProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
