import { Pressable, StyleSheet, Text } from "react-native";
import { useI18n } from "@/lib/locale-context";
import { useTheme } from "@/lib/theme-context";

/**
 * Light/dark toggle (parity with web's ThemeToggle). Shows the label for the
 * theme you'd switch TO (theme.toLight / theme.toDark), from the shared catalog.
 */
export function ThemeToggle() {
  const { isDark, toggleTheme, colors } = useTheme();
  const { m } = useI18n();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={toggleTheme}
      style={[styles.button, { borderColor: colors.border }]}
    >
      <Text style={[styles.label, { color: colors.foreground }]}>
        {isDark ? `☀ ${m.theme.toLight}` : `☾ ${m.theme.toDark}`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  label: { fontSize: 13, fontWeight: "600" },
});
