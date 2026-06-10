import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "@/lib/locale-context";
import { useTheme, type ThemeColors } from "@/lib/theme-context";

/**
 * Shared placeholder for features that aren't built on mobile yet. Themed and
 * i18n'd, with a back button — so the dashboard navigation works end to end and
 * each screen can be filled in for real in a later step.
 */
export function ComingSoon({ title }: { title: string }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, isRTL } = useI18n();
  const { colors } = useTheme();

  const s = useMemo(() => makeStyles(colors), [colors]);
  const textAlign = isRTL ? "right" : "left";

  return (
    <View style={[s.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[s.header, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={({ pressed }) => [s.backBtn, pressed && s.pressed]}
        >
          <Text style={s.backText}>{isRTL ? `${t("common", "back")} ›` : `‹ ${t("common", "back")}`}</Text>
        </Pressable>
      </View>

      <View style={s.body}>
        <Text style={[s.title, { textAlign }]}>{title}</Text>
        <View style={s.badge}>
          <Text style={s.badgeText}>{t("common", "comingSoon")}</Text>
        </View>
        <Text style={[s.subtitle, { textAlign }]}>{t("common", "comingSoonBody")}</Text>
      </View>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, paddingHorizontal: 24, backgroundColor: c.background },
    header: { alignItems: "center" },
    backBtn: { paddingVertical: 6, paddingHorizontal: 4 },
    backText: { color: c.primary, fontSize: 16, fontWeight: "600" },
    pressed: { opacity: 0.6 },
    body: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
    title: { color: c.foreground, fontSize: 28, fontWeight: "800" },
    badge: {
      borderWidth: 1,
      borderColor: c.primary,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 5,
    },
    badgeText: { color: c.primary, fontSize: 12, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
    subtitle: { color: c.mutedForeground, fontSize: 15, lineHeight: 22, textAlign: "center", maxWidth: 320 },
  });
}
