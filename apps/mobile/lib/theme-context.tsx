/**
 * App-wide theme state (light "default" / "dark"), persisted to AsyncStorage.
 *
 * The palette is NOT defined here — colors come from the SAME `themes` object in
 * @platform/config that the web app uses (single source of truth). Switching
 * just swaps which semantic-token set screens read via `useTheme().colors`.
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
import { defaultTheme, themeNames, themes, type ThemeName } from "@platform/config";

const STORAGE_KEY = "platform.theme";

/** The semantic-token palette for a theme (background, foreground, primary, …). */
export type ThemeColors = (typeof themes)[ThemeName];

interface ThemeState {
  themeName: ThemeName;
  colors: ThemeColors;
  isDark: boolean;
  setTheme: (theme: ThemeName) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setThemeState] = useState<ThemeName>(defaultTheme);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored && (themeNames as readonly string[]).includes(stored)) {
          setThemeState(stored as ThemeName);
        }
      })
      .catch(() => {
        // Fall back to the default theme.
      });
  }, []);

  const setTheme = useCallback((next: ThemeName) => {
    setThemeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(themeName === "dark" ? "default" : "dark");
  }, [themeName, setTheme]);

  const value = useMemo<ThemeState>(
    () => ({
      themeName,
      colors: themes[themeName],
      isDark: themeName === "dark",
      setTheme,
      toggleTheme,
    }),
    [themeName, setTheme, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used within a ThemeProvider");
  return value;
}
