/**
 * Presentational bottom tab bar — a floating rounded dock. Home is active; the
 * other tabs have no destinations yet and nudge "coming soon" when tapped.
 */
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useI18n } from "@/lib/locale-context";
import { useTheme, type ThemeColors } from "@/lib/theme-context";
import { radius, space, text, withAlpha } from "@/lib/tokens";
import type { Catalog } from "@/lib/i18n";
import { Glyph, type GlyphName } from "./glyph";

interface TabItem {
  id: string;
  labelKey: keyof Catalog["home"];
  glyph: GlyphName;
}

const TABS: TabItem[] = [
  { id: "home", labelKey: "tabHome", glyph: "home" },
  { id: "schedule", labelKey: "tabSchedule", glyph: "dots" },
  { id: "tasks", labelKey: "tabTasks", glyph: "bars" },
  { id: "chat", labelKey: "tabChat", glyph: "chat" },
  { id: "profile", labelKey: "tabProfile", glyph: "profile" },
];

const ACTIVE_TAB = "home";

export function TabBar({ onNudge }: { onNudge: () => void }) {
  const { t, isRTL } = useI18n();
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={[s.dock, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
      {TABS.map((tab) => {
        const active = tab.id === ACTIVE_TAB;
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={active ? undefined : onNudge}
            style={({ pressed }) => [s.tab, pressed && !active && s.pressed]}
          >
            <View style={[s.iconWrap, active && s.iconWrapActive]}>
              <Glyph
                name={tab.glyph}
                color={active ? colors.primary : colors.mutedForeground}
                size={space.md + space.xs}
              />
            </View>
            <Text style={[s.label, active && s.labelActive]}>{t("home", tab.labelKey)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    dock: {
      marginHorizontal: space.lg,
      backgroundColor: c.card,
      borderRadius: radius.full,
      paddingVertical: space.sm,
      paddingHorizontal: space.sm,
      justifyContent: "space-between",
      shadowColor: c.foreground,
      shadowOpacity: 0.1,
      shadowRadius: radius.xl,
      shadowOffset: { width: 0, height: space.xs },
      elevation: 6,
    },
    tab: { flex: 1, alignItems: "center", gap: space.xs / 2 },
    iconWrap: {
      width: space.xl + space.xs,
      height: space.lg + space.xs,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
    },
    iconWrapActive: { backgroundColor: withAlpha(c.primary, 0.14) },
    label: { color: c.mutedForeground, fontSize: text.xs * 0.92, fontWeight: "500" },
    labelActive: { color: c.primary, fontWeight: "700" },
    pressed: { opacity: 0.6 },
  });
}
