import { defineRouting } from "next-intl/routing";
import { defaultLocale, locales } from "@platform/i18n";

/**
 * Locale-prefixed routing. `localePrefix: "always"` means every path is
 * prefixed (/he/..., /en/...) and "/" redirects to the default locale (he).
 * Locales and the default come from @platform/i18n — the single source.
 */
export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "always",
});
