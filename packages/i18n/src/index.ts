/**
 * @platform/i18n
 * Internationalization and translations — the single source of truth for
 * locales and message catalogs across the platform (web, mobile, etc.).
 */
import en from "./locales/en.json";
import he from "./locales/he.json";

export const i18nVersion = "0.1.0";

/**
 * Supported locales, in display order. Hebrew is first because it is the
 * platform default.
 */
export const locales = ["he", "en"] as const;
export type Locale = (typeof locales)[number];

/** The default locale used when none is specified / detected. */
export const defaultLocale: Locale = "he";

/**
 * Backwards-compatible alias. Prefer `locales` going forward.
 */
export const supportedLanguages = ["en", "he"] as const;

/** Message catalogs keyed by locale. Consumed by next-intl in apps. */
export const messages = { he, en } as Record<Locale, typeof en>;

/** Get the message catalog for a given locale. */
export function getMessages(locale: Locale): typeof en {
  return messages[locale];
}

/** Whether a locale is written right-to-left. */
export function isRtlLocale(locale: Locale): boolean {
  return locale === "he";
}

/** Text direction for a locale, suitable for the HTML `dir` attribute. */
export function getDirection(locale: Locale): "rtl" | "ltr" {
  return isRtlLocale(locale) ? "rtl" : "ltr";
}
