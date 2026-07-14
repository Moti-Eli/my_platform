"use client";

/**
 * i18n context. Holds the active locale, exposes a typed `t(key)`, flips
 * `<html lang/dir>` live when the language changes, and persists the choice to a
 * cookie so the next server render matches.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { type Locale, getDirection } from "./config";
import { dictionaries, translate, type MessageKey } from "./dictionaries";
import { LANG_COOKIE, setPreferenceCookie } from "@/lib/cookies";

interface I18nContextValue {
  locale: Locale;
  dir: "rtl" | "ltr";
  t: (key: MessageKey) => string;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const dir = getDirection(locale);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);

  const setLocale = useCallback((next: Locale) => {
    setPreferenceCookie(LANG_COOKIE, next);
    setLocaleState(next);
  }, []);

  const t = useCallback((key: MessageKey) => translate(dictionaries[locale], key), [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({ locale, dir, t, setLocale }),
    [locale, dir, t, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within <I18nProvider>.");
  return ctx;
}
