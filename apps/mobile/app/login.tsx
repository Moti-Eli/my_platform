import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { signIn } from "@platform/auth";
import { supabase } from "@/lib/supabase";
import { isRTL, t } from "@/lib/i18n";

/**
 * Email + password login, using the SAME @platform/auth `signIn` as web. On
 * success the auth listener (and this navigation) move the user to /home.
 */
export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const textAlign = isRTL ? "right" : "left";

  async function handleSubmit() {
    if (submitting) return;
    setError(null);

    if (!supabase) {
      setError(t("login", "notConfigured"));
      return;
    }

    setSubmitting(true);
    try {
      const { error: signInError } = await signIn(supabase, email.trim(), password);
      if (signInError) {
        // Mirror web: surface a single friendly message for bad credentials.
        setError(t("login", "invalidCredentials"));
        return;
      }
      router.replace("/home");
    } catch {
      setError(t("login", "invalidCredentials"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Stack.Screen options={{ title: t("login", "title") }} />
      <View style={[styles.inner, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }]}>
        <Text style={[styles.eyebrow, { textAlign }]}>{t("login", "eyebrow")}</Text>
        <Text style={[styles.title, { textAlign }]}>{t("login", "title")}</Text>
        <Text style={[styles.subtitle, { textAlign }]}>{t("login", "subtitle")}</Text>

        <View style={styles.field}>
          <Text style={[styles.label, { textAlign }]}>{t("login", "email")}</Text>
          <TextInput
            style={[styles.input, { textAlign }]}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            inputMode="email"
            editable={!submitting}
            placeholder="admin1@organizationA.com"
            placeholderTextColor="#52525b"
          />
        </View>

        <View style={styles.field}>
          <Text style={[styles.label, { textAlign }]}>{t("login", "password")}</Text>
          <TextInput
            style={[styles.input, { textAlign }]}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="password"
            editable={!submitting}
            onSubmitEditing={handleSubmit}
            returnKeyType="go"
          />
        </View>

        {error && (
          <View style={styles.errorBox}>
            <Text style={[styles.errorText, { textAlign }]}>{error}</Text>
          </View>
        )}

        <Pressable
          accessibilityRole="button"
          disabled={submitting}
          onPress={handleSubmit}
          style={({ pressed }) => [styles.button, (pressed || submitting) && styles.buttonPressed]}
        >
          {submitting ? (
            <View style={styles.buttonRow}>
              <ActivityIndicator color="#0b0b0f" />
              <Text style={styles.buttonText}>{t("login", "signingIn")}</Text>
            </View>
          ) : (
            <Text style={styles.buttonText}>{t("login", "submit")}</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b0b0f" },
  inner: { flex: 1, paddingHorizontal: 24, gap: 6, justifyContent: "center" },
  eyebrow: {
    color: "#7c8cff",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  title: { color: "#f5f5f7", fontSize: 30, fontWeight: "800", marginTop: 6 },
  subtitle: { color: "#a1a1aa", fontSize: 14, lineHeight: 20, marginTop: 6, marginBottom: 18 },
  field: { gap: 6, marginBottom: 14 },
  label: { color: "#e4e4e7", fontSize: 14, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderColor: "#26262e",
    backgroundColor: "#141419",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#f5f5f7",
    fontSize: 16,
  },
  errorBox: {
    borderWidth: 1,
    borderColor: "#7f1d1d",
    backgroundColor: "#1f1113",
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  errorText: { color: "#fca5a5", fontSize: 13, lineHeight: 18 },
  button: {
    backgroundColor: "#7c8cff",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  buttonPressed: { opacity: 0.7 },
  buttonRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  buttonText: { color: "#0b0b0f", fontSize: 16, fontWeight: "700" },
});
