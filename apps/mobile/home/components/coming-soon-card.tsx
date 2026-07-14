/**
 * "Coming soon" feature card — the shell's signature piece. A soft elevated
 * card with a tinted glyph medallion, an access badge on gated cards, skeleton
 * "future content" bars, and a coming-soon pill whose dot gently breathes.
 * Pressing gives a spring scale + lets the parent float its coming-soon hint.
 */
import { useEffect, useMemo, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { colors as palette } from "@platform/config";
import { useI18n } from "@/lib/locale-context";
import { useTheme, type ThemeColors } from "@/lib/theme-context";
import { radius, space, text, withAlpha } from "@/lib/tokens";
import type { HomeCard } from "../cards";
import { Glyph } from "./glyph";

function toneColor(tone: HomeCard["tone"], isDark: boolean): string {
  switch (tone) {
    case "primary":
      return palette.primary[500];
    case "success":
      return palette.success[500];
    case "warning":
      return palette.warning[500];
    case "owner":
      // Deep brand tone by day, its light counterpart by night — keeps the
      // owner card legible on a dark card surface.
      return isDark ? palette.primary[100] : palette.primary[900];
  }
}

interface ComingSoonCardProps {
  card: HomeCard;
  onNudge: () => void;
}

export function ComingSoonCard({ card, onNudge }: ComingSoonCardProps) {
  const { t, isRTL } = useI18n();
  const { colors, isDark } = useTheme();
  const tone = toneColor(card.tone, isDark);
  const s = useMemo(() => makeStyles(colors), [colors]);

  const scale = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const pressIn = () =>
    Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 40 }).start();
  const pressOut = () =>
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40 }).start();

  const rowDir = isRTL ? "row-reverse" : "row";
  const textAlign = isRTL ? "right" : "left";

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("home", card.titleKey)}
        onPressIn={pressIn}
        onPressOut={pressOut}
        onPress={onNudge}
        style={s.card}
      >
        <View style={[s.headerRow, { flexDirection: rowDir }]}>
          <View style={[s.medallion, { backgroundColor: withAlpha(tone, 0.12) }]}>
            <Glyph name={card.glyph} color={tone} size={space.lg} />
          </View>
          <View style={s.titleWrap}>
            <Text style={[s.title, { textAlign }]}>{t("home", card.titleKey)}</Text>
            <Text style={[s.desc, { textAlign }]}>{t("home", card.descKey)}</Text>
          </View>
          {card.badgeKey ? (
            <View style={[s.badge, { backgroundColor: withAlpha(tone, 0.12) }]}>
              <Text style={[s.badgeText, { color: tone }]}>{t("home", card.badgeKey)}</Text>
            </View>
          ) : null}
        </View>

        <View style={[s.footerRow, { flexDirection: rowDir }]}>
          <View style={s.skeletonWrap}>
            <View style={[s.skeletonBar, { width: "62%" }]} />
            <View style={[s.skeletonBar, { width: "38%" }]} />
          </View>
          <View style={[s.pill, { flexDirection: rowDir }]}>
            <Animated.View style={[s.pillDot, { backgroundColor: tone, opacity: pulse }]} />
            <Text style={s.pillText}>{t("common", "comingSoon")}</Text>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: c.card,
      borderRadius: radius.xl,
      padding: space.md + space.xs,
      gap: space.md,
      shadowColor: c.foreground,
      shadowOpacity: 0.06,
      shadowRadius: radius.xl,
      shadowOffset: { width: 0, height: space.xs },
      elevation: 3,
    },
    headerRow: { alignItems: "center", gap: space.sm + space.xs },
    medallion: {
      width: space.xl + space.sm,
      height: space.xl + space.sm,
      borderRadius: radius.xl,
      alignItems: "center",
      justifyContent: "center",
    },
    titleWrap: { flex: 1, gap: space.xs / 2 },
    title: { color: c.cardForeground, fontSize: text.lg, fontWeight: "700" },
    desc: { color: c.mutedForeground, fontSize: text.sm, lineHeight: text.sm * 1.4 },
    badge: {
      alignSelf: "flex-start",
      borderRadius: radius.full,
      paddingHorizontal: space.sm,
      paddingVertical: space.xs / 2,
    },
    badgeText: { fontSize: text.xs, fontWeight: "600" },
    footerRow: { alignItems: "center", gap: space.md },
    skeletonWrap: { flex: 1, gap: space.xs + space.xs / 2 },
    skeletonBar: {
      height: space.sm,
      borderRadius: radius.full,
      backgroundColor: c.muted,
    },
    pill: {
      alignItems: "center",
      gap: space.xs + space.xs / 2,
      borderRadius: radius.full,
      backgroundColor: c.muted,
      paddingHorizontal: space.sm + space.xs,
      paddingVertical: space.xs + space.xs / 2,
    },
    pillDot: { width: space.xs + space.xs / 2, height: space.xs + space.xs / 2, borderRadius: radius.full },
    pillText: { color: c.mutedForeground, fontSize: text.xs, fontWeight: "600" },
  });
}
