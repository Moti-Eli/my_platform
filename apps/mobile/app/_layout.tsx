// `URL` is used by supabase-js; React Native's implementation is incomplete, so
// load the polyfill before anything touches the network. Must be the first import.
import "react-native-url-polyfill/auto";

import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as SplashScreen from "expo-splash-screen";

import { AuthProvider } from "@/lib/auth-context";
import { ThemeProvider, useTheme } from "@/lib/theme-context";
import { LocaleProvider } from "@/lib/locale-context";

// Keep the splash up until WE decide to hide it, then hide it on mount below —
// NOT gated on any fetch, so a slow/hung network request can't keep us stuck on
// the splash screen.
SplashScreen.preventAutoHideAsync().catch(() => {});

// Inner tree: lives under ThemeProvider so the navigator background and status
// bar follow the active theme (no flash of the wrong palette between screens).
function ThemedApp() {
  const { colors, isDark } = useTheme();
  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      />
      <StatusBar style={isDark ? "light" : "dark"} />
    </>
  );
}

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <LocaleProvider>
          <AuthProvider>
            <ThemedApp />
          </AuthProvider>
        </LocaleProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
