/** Cortex i18n public surface. Import from `@/i18n`. */
export { locales, defaultLocale, getDirection, isLocale } from "./config";
export type { Locale } from "./config";
export { dictionaries, translate } from "./dictionaries";
export type { Messages, MessageKey } from "./dictionaries";
export { I18nProvider, useI18n } from "./I18nProvider";
