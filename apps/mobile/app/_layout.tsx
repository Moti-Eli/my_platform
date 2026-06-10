// `URL` is used by supabase-js; React Native's implementation is incomplete, so
// load the polyfill before anything touches the network. Must be the first import.
import "react-native-url-polyfill/auto";

import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as SplashScreen from "expo-splash-screen";

// Keep the splash up until WE decide to hide it, then hide it on mount below —
// NOT gated on any fetch, so a slow/hung network request can't keep us stuck on
// the splash screen.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    <SafeAreaProvider>
      <Stack />
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
