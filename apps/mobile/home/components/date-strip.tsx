/**
 * Horizontal date strip — presentational only. Shows a two-week window starting
 * two days back; tapping a day just moves the visual selection (no data behind
 * it yet). Today is marked with a dot and starts selected.
 */
import { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View, StyleSheet } from "react-native";
import { useI18n } from "@/lib/locale-context";
import { useTheme, type ThemeColors } from "@/lib/theme-context";
import { radius, space, text, withAlpha } from "@/lib/tokens";

const DAYS_BACK = 2;
const DAYS_TOTAL = 14;

interface StripDay {
  key: string;
  weekday: string;
  dayOfMonth: number;
  isToday: boolean;
}

export function DateStrip() {
  const { locale, isRTL } = useI18n();
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const days = useMemo<StripDay[]>(() => {
    const weekdayFmt = new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-US", {
      weekday: "short",
    });
    const today = new Date();
    return Array.from({ length: DAYS_TOTAL }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() + (i - DAYS_BACK));
      return {
        key: d.toISOString().slice(0, 10),
        weekday: weekdayFmt.format(d),
        dayOfMonth: d.getDate(),
        isToday: i === DAYS_BACK,
      };
    });
  }, [locale]);

  const todayKey = days[DAYS_BACK]?.key ?? "";
  const [selectedKey, setSelectedKey] = useState(todayKey);
  const scrollRef = useRef<ScrollView>(null);

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[s.row, { flexDirection: isRTL ? "row-reverse" : "row" }]}
      // With row-reverse (RTL) the strip's start — today — sits at the content's
      // RIGHT end, but a horizontal ScrollView opens at the left edge; snap to
      // the correct end whenever direction/content changes.
      onContentSizeChange={() => {
        if (isRTL) scrollRef.current?.scrollToEnd({ animated: false });
        else scrollRef.current?.scrollTo({ x: 0, animated: false });
      }}
    >
      {days.map((day) => {
        const selected = day.key === selectedKey;
        return (
          <Pressable
            key={day.key}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => setSelectedKey(day.key)}
            style={[s.day, selected && s.daySelected]}
          >
            <Text style={[s.weekday, selected && s.weekdaySelected]}>{day.weekday}</Text>
            <Text style={[s.num, selected && s.numSelected]}>{day.dayOfMonth}</Text>
            <View style={[s.todayDot, day.isToday && !selected && s.todayDotVisible]} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    row: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.xs },
    day: {
      alignItems: "center",
      paddingVertical: space.sm + space.xs,
      paddingHorizontal: space.sm,
      minWidth: space.xl + space.sm,
      borderRadius: radius.xl,
      gap: space.xs / 2,
    },
    daySelected: {
      backgroundColor: c.primary,
      shadowColor: c.primary,
      shadowOpacity: 0.35,
      shadowRadius: radius.lg,
      shadowOffset: { width: 0, height: space.xs },
      elevation: 4,
    },
    weekday: { color: c.mutedForeground, fontSize: text.xs, fontWeight: "500" },
    weekdaySelected: { color: withAlpha(c.primaryForeground, 0.8) },
    num: { color: c.foreground, fontSize: text.base, fontWeight: "700" },
    numSelected: { color: c.primaryForeground },
    todayDot: {
      width: space.xs,
      height: space.xs,
      borderRadius: space.xs / 2,
      backgroundColor: c.primary,
      opacity: 0,
    },
    todayDotVisible: { opacity: 1 },
  });
}
