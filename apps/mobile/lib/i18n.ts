/**
 * Pure i18n helpers for the mobile app (no React state — that lives in
 * locale-context). Strings come from the SAME shared @platform/i18n catalogs the
 * web app uses; nothing is hardcoded or duplicated here.
 */
import { getMessages, type Locale } from "@platform/i18n";

/** The message catalog shape (mirrors the English catalog). */
export type Catalog = ReturnType<typeof getMessages>;

/**
 * Build a typed translator bound to a locale, e.g. `t("login", "title")`.
 * For nested landing content (objects/arrays), read the raw catalog (`m`)
 * exposed by the locale context instead.
 */
export function makeT(locale: Locale) {
  const catalog = getMessages(locale);
  function t<NS extends keyof Catalog, K extends keyof Catalog[NS]>(
    namespace: NS,
    key: K
  ): Catalog[NS][K] {
    return catalog[namespace][key];
  }
  return t;
}

export type Translate = ReturnType<typeof makeT>;
