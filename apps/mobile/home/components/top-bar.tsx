/**
 * Home top bar: side-drawer icon (opens the provisional drawer), app name, and
 * the avatar showing the user's initial — tapping it signs out (with confirm).
 */
import { useMemo } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useI18n } from "@/lib/locale-context";
import { useTheme, type ThemeColors } from "@/lib/theme-context";
import { radius, space, text, withAlpha } from "@/lib/tokens";
import { Glyph } from "./glyph";

interface TopBarProps {
  /** User email — the avatar shows its first letter. */
  email: string | undefined;
  onMenu: () => void;
  onAvatar: () => void;
  signingOut: boolean;
}

export function TopBar({ email, onMenu, onAvatar, signingOut }: TopBarProps) {
  const { t, isRTL } = useI18n();
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const initial = (email?.trim()[0] ?? "?").toUpperCase();

  return (
    <View style={[s.bar, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
      <Pressable
        accessibilityRole="button"
        onPress={onMenu}
        hitSlop={space.sm}
        style={({ pressed }) => [s.iconButton, pressed && s.pressed]}
      >
        <Glyph name="menu" color={colors.foreground} size={space.md + space.xs} />
      </Pressable>

      <Text style={s.appName}>{t("common", "appName")}</Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("dashboard", "logout")}
        disabled={signingOut}
        onPress={onAvatar}
        style={({ pressed }) => [s.avatar, (pressed || signingOut) && s.pressed]}
      >
        {signingOut ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Text style={s.avatarText}>{initial}</Text>
        )}
      </Pressable>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  const touch = space.xl + space.sm; // 40dp touch targets
  return StyleSheet.create({
    bar: {
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: space.lg,
      paddingVertical: space.sm,
    },
    iconButton: {
      width: touch,
      height: touch,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
    },
    appName: { color: c.foreground, fontSize: text.lg, fontWeight: "800", letterSpacing: 0.3 },
    avatar: {
      width: touch,
      height: touch,
      borderRadius: radius.full,
      backgroundColor: withAlpha(c.primary, 0.14),
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: { color: c.primary, fontSize: text.base, fontWeight: "700" },
    pressed: { opacity: 0.6 },
  });
}
