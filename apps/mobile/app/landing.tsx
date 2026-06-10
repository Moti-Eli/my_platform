import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "@/lib/locale-context";
import { useTheme, type ThemeColors } from "@/lib/theme-context";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Logged-out landing screen — mobile-native parity with the web landing page:
 * top bar (language + theme switchers), hero + CTA, scrollable explainer
 * sections, and a demo-logins section (gated). All copy comes from the shared
 * @platform/i18n `landing`/`common` namespaces; all colors from @platform/config
 * tokens via the theme context.
 */

// Demo fixtures (identifiers, not translatable copy) — mirror the web's
// DemoAccess. Gated below so they never show in a real production build.
const DEMO_PASSWORD = "123456";
const DEMO = {
  owner: "owner@platform.test",
  orgA: {
    admins: ["admin1@organizationA.com", "admin2@organizationA.com"],
    members: ["user1@organizationA.com", "user2@organizationA.com", "user3@organizationA.com"],
  },
  orgB: {
    admins: ["admin1@organizationB.com", "admin2@organizationB.com"],
    members: ["user1@organizationB.com", "user2@organizationB.com", "user3@organizationB.com"],
  },
};

// Same rule as web's isDemoAccessEnabled: opt-in flag, or any non-production run.
const showDemo =
  process.env.EXPO_PUBLIC_SHOW_DEMO_ACCESS === "1" || process.env.NODE_ENV !== "production";

export default function LandingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { m, isRTL } = useI18n();
  const { colors } = useTheme();

  const s = useMemo(() => makeStyles(colors), [colors]);
  const textAlign = isRTL ? "right" : "left";
  const rowDir = isRTL ? "row-reverse" : "row";
  const land = m.landing;

  const sections = [land.whatIs, land.architecture, land.security, land.why];

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={[s.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}
    >
      <Stack.Screen options={{ headerShown: false }} />

      {/* Top bar: brand + switchers */}
      <View style={[s.topBar, { flexDirection: rowDir }]}>
        <Text style={[s.brand, { textAlign }]}>{m.common.appName}</Text>
        <View style={[s.switchers, { flexDirection: rowDir }]}>
          <LanguageSwitcher />
          <ThemeToggle />
        </View>
      </View>

      {/* Hero */}
      <View style={s.hero}>
        <Text style={[s.eyebrow, { textAlign }]}>{land.eyebrow}</Text>
        <Text style={[s.headline, { textAlign }]}>{land.headline}</Text>
        <Text style={[s.subhead, { textAlign }]}>{land.subhead}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/login")}
          style={({ pressed }) => [s.cta, pressed && s.pressed]}
        >
          <Text style={s.ctaText}>{land.ctaExplore}</Text>
        </Pressable>
      </View>

      {/* Explainer sections */}
      {sections.map((sec) => (
        <View key={sec.num} style={s.section}>
          <Text style={[s.sectionNum, { textAlign }]}>{sec.num}</Text>
          <Text style={[s.sectionTitle, { textAlign }]}>{sec.title}</Text>
          <Text style={[s.sectionLead, { textAlign }]}>{sec.lead}</Text>
          <View style={s.points}>
            {sec.points.map((point) => (
              <View key={point} style={[s.point, { flexDirection: rowDir }]}>
                <View style={s.bullet} />
                <Text style={[s.pointText, { textAlign }]}>{point}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}

      {/* Demo logins (gated) */}
      {showDemo && (
        <View style={[s.section, s.demo]}>
          <Text style={[s.demoKicker, { textAlign }]}>{land.demo.kicker}</Text>
          <Text style={[s.sectionTitle, { textAlign }]}>{land.demo.title}</Text>
          <Text style={[s.sectionLead, { textAlign }]}>{land.demo.subtitle}</Text>

          <Text style={[s.demoPassword, { textAlign }]}>
            {land.demo.passwordLabel}: <Text style={s.code}>{DEMO_PASSWORD}</Text>
          </Text>

          <Text style={[s.demoGroupTitle, { textAlign }]}>{land.demo.owner}</Text>
          <Text style={[s.demoNote, { textAlign }]}>{land.demo.ownerNote}</Text>
          <Text style={[s.code, { textAlign }]}>{DEMO.owner}</Text>

          {([
            [land.demo.orgA, DEMO.orgA],
            [land.demo.orgB, DEMO.orgB],
          ] as const).map(([orgLabel, org]) => (
            <View key={orgLabel} style={s.demoOrg}>
              <Text style={[s.demoGroupTitle, { textAlign }]}>{orgLabel}</Text>
              <Text style={[s.demoNote, { textAlign }]}>{land.demo.admins}</Text>
              {org.admins.map((email) => (
                <Text key={email} style={[s.code, { textAlign }]}>{email}</Text>
              ))}
              <Text style={[s.demoNote, { textAlign }]}>{land.demo.members}</Text>
              {org.members.map((email) => (
                <Text key={email} style={[s.code, { textAlign }]}>{email}</Text>
              ))}
            </View>
          ))}

          <Text style={[s.demoDisclaimer, { textAlign }]}>{land.demo.note}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/login")}
            style={({ pressed }) => [s.cta, pressed && s.pressed]}
          >
            <Text style={s.ctaText}>{land.demo.cta}</Text>
          </Pressable>
        </View>
      )}

      {/* Footer */}
      <View style={s.footer}>
        <Text style={[s.footerText, { textAlign }]}>{land.footer}</Text>
      </View>
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    content: { paddingHorizontal: 24, gap: 8 },
    topBar: { alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
    brand: { color: c.foreground, fontSize: 18, fontWeight: "800" },
    switchers: { alignItems: "center", gap: 8 },
    hero: { gap: 12, paddingVertical: 16 },
    eyebrow: {
      color: c.primary,
      fontSize: 12,
      fontWeight: "700",
      letterSpacing: 1.5,
      textTransform: "uppercase",
    },
    headline: { color: c.foreground, fontSize: 34, fontWeight: "900", lineHeight: 40 },
    subhead: { color: c.mutedForeground, fontSize: 16, lineHeight: 24 },
    cta: {
      backgroundColor: c.primary,
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 20,
      alignItems: "center",
      marginTop: 8,
    },
    pressed: { opacity: 0.8 },
    ctaText: { color: c.primaryForeground, fontSize: 16, fontWeight: "700" },
    section: { gap: 8, paddingVertical: 20, borderTopWidth: 1, borderTopColor: c.border },
    sectionNum: { color: c.primary, fontSize: 14, fontWeight: "700", fontFamily: "monospace" },
    sectionTitle: { color: c.foreground, fontSize: 24, fontWeight: "800", lineHeight: 30 },
    sectionLead: { color: c.mutedForeground, fontSize: 14, lineHeight: 20, marginBottom: 6 },
    points: { gap: 12, marginTop: 4 },
    point: { gap: 12, alignItems: "flex-start" },
    bullet: { width: 18, height: 2, marginTop: 9, backgroundColor: c.primary, borderRadius: 1 },
    pointText: { flex: 1, color: c.foreground, fontSize: 15, lineHeight: 22, opacity: 0.85 },
    demo: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 18, marginTop: 8 },
    demoKicker: { color: c.primary, fontSize: 12, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
    demoPassword: { color: c.foreground, fontSize: 14, marginTop: 8, marginBottom: 4 },
    demoGroupTitle: { color: c.foreground, fontSize: 16, fontWeight: "700", marginTop: 12 },
    demoNote: { color: c.mutedForeground, fontSize: 13, marginTop: 4 },
    demoOrg: { gap: 2 },
    code: { color: c.mutedForeground, fontSize: 13, fontFamily: "monospace" },
    demoDisclaimer: { color: c.mutedForeground, fontSize: 12, fontStyle: "italic", marginTop: 14, lineHeight: 18 },
    footer: { borderTopWidth: 1, borderTopColor: c.border, paddingTop: 16, marginTop: 8 },
    footerText: { color: c.mutedForeground, fontSize: 12 },
  });
}
