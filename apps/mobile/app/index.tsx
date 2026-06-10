import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Shared monorepo packages — importing from all four proves they resolve on
// mobile through Metro (the point of this STEP 1 skeleton).
import { coreVersion } from "@platform/core";
import { defaultLocale } from "@platform/i18n";
import { createNativeDbClient } from "@platform/db";
import { getAllPermissionKeys } from "@platform/auth";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; keys: string[] };

export default function HealthCheckScreen() {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let active = true;

    async function probe() {
      if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
        setState({
          status: "error",
          message:
            "Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY. " +
            "Copy .env.example to .env.local and fill them in.",
        });
        return;
      }
      try {
        // db (client) + auth (query) — the actual connectivity proof.
        const supabase = createNativeDbClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
        const keys = await getAllPermissionKeys(supabase);
        if (active) setState({ status: "ok", keys: keys.slice().sort() });
      } catch (err) {
        if (active) {
          setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
        }
      }
    }

    void probe();
    return () => {
      active = false;
    };
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <Stack.Screen options={{ title: "Health check" }} />

      <Text style={styles.kicker}>@platform/mobile</Text>
      <Text style={styles.title}>Supabase health check</Text>
      <Text style={styles.subtitle}>
        Proves the app runs and reaches Supabase via the shared packages.
      </Text>

      {state.status === "loading" && (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
          <Text style={styles.muted}>Fetching permissions…</Text>
        </View>
      )}

      {state.status === "error" && (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>Could not reach Supabase</Text>
          <Text style={styles.errorText}>{state.message}</Text>
        </View>
      )}

      {state.status === "ok" && (
        <View style={styles.flex}>
          <Text style={styles.ok}>✓ Connected — {state.keys.length} permission keys</Text>
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {state.keys.map((key) => (
              <Text key={key} style={styles.key}>
                {key}
              </Text>
            ))}
          </ScrollView>
        </View>
      )}

      <Text style={styles.footer}>
        core v{coreVersion} · default locale: {defaultLocale}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24, backgroundColor: "#0b0b0f", gap: 8 },
  flex: { flex: 1 },
  kicker: { color: "#7c8cff", fontSize: 12, fontWeight: "600", letterSpacing: 1.5, textTransform: "uppercase" },
  title: { color: "#f5f5f7", fontSize: 28, fontWeight: "800", marginTop: 6 },
  subtitle: { color: "#a1a1aa", fontSize: 14, lineHeight: 20, marginTop: 6, marginBottom: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  muted: { color: "#a1a1aa", fontSize: 14 },
  ok: { color: "#34d399", fontSize: 15, fontWeight: "600", marginBottom: 12 },
  list: { flex: 1, borderWidth: 1, borderColor: "#26262e", borderRadius: 12, backgroundColor: "#141419" },
  listContent: { padding: 12, gap: 8 },
  key: { color: "#e4e4e7", fontSize: 14, fontFamily: "monospace" },
  errorBox: {
    borderWidth: 1,
    borderColor: "#7f1d1d",
    backgroundColor: "#1f1113",
    borderRadius: 12,
    padding: 16,
    gap: 6,
  },
  errorTitle: { color: "#f87171", fontSize: 15, fontWeight: "700" },
  errorText: { color: "#fca5a5", fontSize: 13, lineHeight: 18 },
  footer: { color: "#52525b", fontSize: 12, marginTop: 12, textAlign: "center" },
});
