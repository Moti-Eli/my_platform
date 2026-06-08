import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { getDirection, type Locale } from "@platform/i18n";
import {
  defaultTheme,
  themeNames,
  themeStylesheet,
  type ThemeName,
} from "@platform/config";
import { routing } from "@/i18n/routing";
import "../globals.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  // Enable static rendering / make the locale available to next-intl APIs.
  setRequestLocale(locale);

  const messages = await getMessages();

  // Theme is persisted in a cookie and applied server-side, so the very first
  // paint already has the correct theme (no flash, no hydration mismatch).
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get("theme")?.value;
  const theme: ThemeName = themeNames.includes(themeCookie as ThemeName)
    ? (themeCookie as ThemeName)
    : defaultTheme;

  const dir = getDirection(locale as Locale);

  return (
    <html lang={locale} dir={dir} data-theme={theme}>
      <body className="min-h-screen antialiased">
        <style dangerouslySetInnerHTML={{ __html: themeStylesheet() }} />
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
