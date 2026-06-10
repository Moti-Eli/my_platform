// `URL` is used by supabase-js; React Native's implementation is incomplete, so
// load the polyfill before anything touches the network. Must be the first import.
import "react-native-url-polyfill/auto";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <>
      <Stack />
      <StatusBar style="auto" />
    </>
  );
}
