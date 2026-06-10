import { useMemo, useState } from "react";
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
import { useI18n } from "@/lib/locale-context";
import { useTheme, type ThemeColors } from "@/lib/theme-context";

/**
 * Email + password login, using the SAME @platform/auth `signIn` as web. On
 * success the auth listener (and this navigation) move the user to /home.
 * Colors come from theme tokens; strings + direction from the locale context.
 */
export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, isRTL } = useI18n();
  const { colors } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const s = useMemo(() => makeStyles(colors), [colors]);
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
      style={s.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Stack.Screen options={{ title: t("login", "title") }} />
      <View style={[s.inner, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }]}>
        <Text style={[s.eyebrow, { textAlign }]}>{t("login", "eyebrow")}</Text>
        <Text style={[s.title, { textAlign }]}>{t("login", "title")}</Text>
        <Text style={[s.subtitle, { textAlign }]}>{t("login", "subtitle")}</Text>

        <View style={s.field}>
          <Text style={[s.label, { textAlign }]}>{t("login", "email")}</Text>
          <TextInput
            style={[s.input, { textAlign }]}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            inputMode="email"
            editable={!submitting}
            placeholder="admin1@organizationA.com"
            placeholderTextColor={colors.mutedForeground}
          />
        </View>

        <View style={s.field}>
          <Text style={[s.label, { textAlign }]}>{t("login", "password")}</Text>
          <TextInput
            style={[s.input, { textAlign }]}
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
          <View style={s.errorBox}>
            <Text style={[s.errorText, { textAlign }]}>{error}</Text>
          </View>
        )}

        <Pressable
          accessibilityRole="button"
          disabled={submitting}
          onPress={handleSubmit}
          style={({ pressed }) => [s.button, (pressed || submitting) && s.buttonPressed]}
        >
          {submitting ? (
            <View style={s.buttonRow}>
              <ActivityIndicator color={colors.primaryForeground} />
              <Text style={s.buttonText}>{t("login", "signingIn")}</Text>
            </View>
          ) : (
            <Text style={s.buttonText}>{t("login", "submit")}</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    inner: { flex: 1, paddingHorizontal: 24, gap: 6, justifyContent: "center" },
    eyebrow: {
      color: c.primary,
      fontSize: 12,
      fontWeight: "600",
      letterSpacing: 1.5,
      textTransform: "uppercase",
    },
    title: { color: c.foreground, fontSize: 30, fontWeight: "800", marginTop: 6 },
    subtitle: { color: c.mutedForeground, fontSize: 14, lineHeight: 20, marginTop: 6, marginBottom: 18 },
    field: { gap: 6, marginBottom: 14 },
    label: { color: c.foreground, fontSize: 14, fontWeight: "600" },
    input: {
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      color: c.foreground,
      fontSize: 16,
    },
    errorBox: {
      borderWidth: 1,
      borderColor: c.destructive,
      backgroundColor: c.card,
      borderRadius: 12,
      padding: 12,
      marginBottom: 14,
    },
    errorText: { color: c.destructive, fontSize: 13, lineHeight: 18 },
    button: {
      backgroundColor: c.primary,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: "center",
      marginTop: 4,
    },
    buttonPressed: { opacity: 0.7 },
    buttonRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    buttonText: { color: c.primaryForeground, fontSize: 16, fontWeight: "700" },
  });
}
