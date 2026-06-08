import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { messages, type Locale } from "@platform/i18n";
import { routing } from "./routing";

/**
 * Per-request next-intl config. Messages are pulled from @platform/i18n — the
 * single source of truth — so apps never keep their own copy of translations.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: messages[locale as Locale],
  };
});
