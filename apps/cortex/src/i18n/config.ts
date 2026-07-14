/**
 * Cortex i18n configuration — locales, default, and direction.
 *
 * We use a minimal, typed, CLIENT-side dictionary (see `dictionaries.ts`) rather
 * than reusing the web app's next-intl setup. Rationale: next-intl is built
 * around locale-prefixed ROUTING and server message loading; this shell instead
 * lets the user pick a language in Settings and persists it locally (a cookie),
 * switching live with no route change. A small typed dictionary + a React
 * context fits that model exactly and adds no dependency. `he` is default; `en`
 * is a full parallel set. Direction follows the active language.
 */
export const locales = ["he", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "he";

/** Text direction for a locale (Hebrew is RTL; English is LTR). */
export function getDirection(locale: Locale): "rtl" | "ltr" {
  return locale === "he" ? "rtl" : "ltr";
}

/** Narrow an untrusted string (e.g. a cookie value) to a known locale. */
export function isLocale(value: string | undefined): value is Locale {
  return value !== undefined && (locales as readonly string[]).includes(value);
}
