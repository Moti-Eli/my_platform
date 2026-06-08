"use client";

import { useLocale, useTranslations } from "next-intl";
import { locales } from "@platform/i18n";
import { Link, usePathname } from "@/i18n/navigation";

/**
 * Switches between /he and /en while preserving the current path. `usePathname`
 * returns the locale-agnostic path; `<Link locale>` re-prefixes it.
 */
export function LanguageSwitcher() {
  const current = useLocale();
  const pathname = usePathname();
  const t = useTranslations("language");

  return (
    <nav className="flex items-center gap-3 text-sm" aria-label="Language">
      {locales.map((locale) => (
        <Link
          key={locale}
          href={pathname}
          locale={locale}
          aria-current={locale === current ? "true" : undefined}
          className={
            locale === current
              ? "font-semibold text-foreground underline"
              : "text-muted-foreground hover:text-foreground"
          }
        >
          {t(locale)}
        </Link>
      ))}
    </nav>
  );
}
