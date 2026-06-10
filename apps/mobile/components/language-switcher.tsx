import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native";
import { useI18n } from "@/lib/locale-context";
import { useTheme } from "@/lib/theme-context";
import type { Locale } from "@platform/i18n";

/**
 * He/En switcher (parity with web's LanguageSwitcher). Two pills; the active
 * locale is highlighted. Labels come from the shared catalog (language.he/en).
 */
export function LanguageSwitcher() {
  const { locale, setLocale, m } = useI18n();
  const { colors } = useTheme();

  const options: { value: Locale; label: string }[] = [
    { value: "he", label: m.language.he },
    { value: "en", label: m.language.en },
  ];

  return (
    <View style={[styles.group, { borderColor: colors.border }]}>
      {options.map((opt) => {
        const active = locale === opt.value;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => setLocale(opt.value)}
            style={[styles.pill, active && { backgroundColor: colors.primary }]}
          >
            <Text
              style={[
                styles.label,
                { color: active ? colors.primaryForeground : colors.mutedForeground },
              ]}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: "row", borderWidth: 1, borderRadius: 10, overflow: "hidden" },
  pill: { paddingHorizontal: 12, paddingVertical: 6 },
  label: { fontSize: 13, fontWeight: "600" },
});
