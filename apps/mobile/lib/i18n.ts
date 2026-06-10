/**
 * Minimal i18n for the mobile app. Web uses next-intl; React Native doesn't, so
 * we read the SAME shared catalogs from @platform/i18n and expose a tiny typed
 * `t()` helper. Strings live in the shared package, never hardcoded here.
 *
 * Defaults to Hebrew (RTL), matching the web default. A full in-app locale
 * switcher can come later; for now `locale` is fixed.
 */
import {
  getMessages,
  defaultLocale,
  getDirection,
  type Locale,
} from "@platform/i18n";

export const locale: Locale = defaultLocale; // "he" for now

const catalog = getMessages(locale);

/** Text direction for the active locale ("rtl" for Hebrew). */
export const direction = getDirection(locale);
export const isRTL = direction === "rtl";

type Catalog = typeof catalog;

/** Look up a translation, e.g. `t("login", "title")`. Fully typed. */
export function t<NS extends keyof Catalog, K extends keyof Catalog[NS]>(
  namespace: NS,
  key: K
): Catalog[NS][K] {
  return catalog[namespace][key];
}
