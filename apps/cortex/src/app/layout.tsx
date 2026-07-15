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
import { AppShell } from "@/components/shell/AppShell";
import { ServiceWorkerRegister } from "@/components/pwa/ServiceWorkerRegister";
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
        <I18nProvider initialLocale={locale}>
          <ThemeProvider initialTheme={theme}>
            <AppShell>{children}</AppShell>
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
