/**
 * The app-wide Supabase client for React Native.
 *
 * Web uses `@supabase/ssr` (cookie-based sessions); React Native has no cookies,
 * so we use the plain supabase-js client (via @platform/db's native factory) and
 * persist the session in AsyncStorage. This is what makes "stay logged in across
 * app restarts" work: on launch, `getSession()` reads the session back out of
 * AsyncStorage. The secret/service-role key is NEVER used here — mobile is a
 * client and only ever holds the publishable (anon) key.
 *
 * Created once at module scope so a single client owns the session and token
 * auto-refresh for the whole app.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { createNativeDbClient } from "@platform/db";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** Whether the Supabase env vars are present. Mirrors web's "notConfigured". */
export const isSupabaseConfigured = Boolean(url && key);

/**
 * The shared client, or `null` if env vars are missing (so the UI can show a
 * friendly "not configured" message instead of crashing on an empty URL).
 */
export const supabase =
  url && key ? createNativeDbClient(url, key, { storage: AsyncStorage }) : null;

// Supabase recommends gating token auto-refresh on app foreground state so it
// doesn't run (and fail) while the app is backgrounded.
if (supabase) {
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      void supabase.auth.startAutoRefresh();
    } else {
      void supabase.auth.stopAutoRefresh();
    }
  });
}
