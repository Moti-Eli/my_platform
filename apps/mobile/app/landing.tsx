import { Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { t, isRTL } from "@/lib/i18n";

/**
 * Logged-out entry point (parity with web's landing page): app name, a one-line
 * description, and a "Sign in" button → /login. Purely presentational — it
 * touches no session/auth logic.
 */
export default function LandingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const textAlign = isRTL ? "right" : "left";

  return (
    <View style={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.hero}>
        <Text style={[styles.eyebrow, { textAlign }]}>@platform</Text>
        <Text style={[styles.title, { textAlign }]}>{t("common", "appName")}</Text>
        <Text style={[styles.tagline, { textAlign }]}>{t("home", "tagline")}</Text>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/login")}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      >
        <Text style={styles.buttonText}>{t("login", "link")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24, backgroundColor: "#0b0b0f", justifyContent: "center", gap: 32 },
  hero: { gap: 10 },
  eyebrow: {
    color: "#7c8cff",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  title: { color: "#f5f5f7", fontSize: 40, fontWeight: "800" },
  tagline: { color: "#a1a1aa", fontSize: 16, lineHeight: 24 },
  button: {
    backgroundColor: "#7c8cff",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonPressed: { opacity: 0.7 },
  buttonText: { color: "#0b0b0f", fontSize: 16, fontWeight: "700" },
});
