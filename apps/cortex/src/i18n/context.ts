"use client";

/**
 * The i18n React context, in a module of its own ON PURPOSE: it imports no
 * dictionaries (type-only imports are erased), so editing a translation JSON
 * in dev does not re-evaluate it. When `createContext` lived next to the
 * dictionaries, every JSON change minted a NEW context object; already-loaded
 * screens then read a context no provider supplies, and the server render threw
 * "useI18n must be used within <I18nProvider>" (dev only).
 */
import { createContext } from "react";
import type { Locale } from "./config";
import type { MessageKey } from "./dictionaries";

export interface I18nContextValue {
  locale: Locale;
  dir: "rtl" | "ltr";
  t: (key: MessageKey) => string;
  setLocale: (locale: Locale) => void;
}

export const I18nContext = createContext<I18nContextValue | null>(null);
