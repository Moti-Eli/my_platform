/**
 * App-wide locale state (he/en) with RTL/LTR direction, persisted to
 * AsyncStorage. Web switches locale via URL routing; mobile has no URL, so the
 * choice lives in context + storage and every screen reads it via `useI18n()`.
 *
 * Note on RTL: React Native's native mirroring (`I18nManager.forceRTL`) requires
 * a full app reload to take effect and is flaky in Expo Go, so we flip direction
 * at the layout level instead (text alignment + row direction from `isRTL`),
 * which switches immediately without a restart.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  defaultLocale,
  getDirection,
  getMessages,
  locales,
  type Locale,
} from "@platform/i18n";
import { makeT, type Catalog, type Translate } from "./i18n";

const STORAGE_KEY = "platform.locale";

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  dir: "rtl" | "ltr";
  isRTL: boolean;
  /** Typed translator for flat keys, e.g. t("login", "title"). */
  t: Translate;
  /** Raw catalog for nested content (e.g. m.landing.whatIs.points). */
  m: Catalog;
}

const LocaleContext = createContext<LocaleState | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored && (locales as readonly string[]).includes(stored)) {
          setLocaleState(stored as Locale);
        }
      })
      .catch(() => {
        // Fall back to the default locale.
      });
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const toggleLocale = useCallback(() => {
    setLocale(locale === "he" ? "en" : "he");
  }, [locale, setLocale]);

  const value = useMemo<LocaleState>(() => {
    const dir = getDirection(locale);
    return {
      locale,
      setLocale,
      toggleLocale,
      dir,
      isRTL: dir === "rtl",
      t: makeT(locale),
      m: getMessages(locale),
    };
  }, [locale, setLocale, toggleLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n(): LocaleState {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useI18n must be used within a LocaleProvider");
  return value;
}
