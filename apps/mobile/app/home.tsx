import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Redirect, Stack, useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  getUserOrganizations,
  isPlatformOwner,
  signOut,
  type UserOrganization,
} from "@platform/auth";
import { captureException } from "@platform/observability";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/locale-context";
import { useTheme, type ThemeColors } from "@/lib/theme-context";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Dashboard — parity with web's /dashboard. Shows the user's email, their
 * organization(s) + role(s) (membership resolution via @platform/auth), and
 * role-aware navigation to features:
 *   - Members + Chat   → only when the user belongs to an organization
 *   - Platform admin   → only for platform owners (isPlatformOwner)
 * Feature screens are placeholders for now (filled in later steps).
 */
type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; orgs: UserOrganization[]; owner: boolean };

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session } = useAuth();
  const { t, isRTL } = useI18n();
  const { colors } = useTheme();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [loggingOut, setLoggingOut] = useState(false);

  const s = useMemo(() => makeStyles(colors), [colors]);
  const userId = session?.user.id;
  const textAlign = isRTL ? "right" : "left";
  const rowDir = isRTL ? "row-reverse" : "row";

  useEffect(() => {
    if (!supabase || !userId) return;
    let active = true;
    setState({ status: "loading" });

    Promise.all([getUserOrganizations(supabase, userId), isPlatformOwner(supabase)])
      .then(([orgs, owner]) => {
        if (active) setState({ status: "ok", orgs, owner });
      })
      .catch((err: unknown) => {
        // Never render raw server/PostgREST text — log the detail, show a key.
        captureException(err, { screen: "dashboard", action: "load" });
        if (active) setState({ status: "error", message: t("common", "loadError") });
      });

    return () => {
      active = false;
    };
  }, [userId, t]);

  async function handleLogout() {
    if (loggingOut || !supabase) return;
    setLoggingOut(true);
    try {
      await signOut(supabase);
      router.replace("/landing");
    } finally {
      setLoggingOut(false);
    }
  }

  // If the session is gone (e.g. logout elsewhere), bounce to the logged-out
  // entry point (landing), not straight to login — landing is where logged-out
  // users belong, with a Sign in button onward to /login.
  if (!session) {
    return <Redirect href="/landing" />;
  }

  // Role-aware feature list (same rules as web's fixed dashboard).
  const hasOrganization = state.status === "ok" && state.orgs.length > 0;
  const owner = state.status === "ok" && state.owner;
  const features: { key: string; href: Href; title: string; desc: string }[] = [];
  if (hasOrganization) {
    features.push({
      key: "members",
      href: "/members",
      title: t("dashboard", "manageMembers"),
      desc: t("dashboard", "manageMembersDesc"),
    });
    features.push({
      key: "chat",
      href: "/chat",
      title: t("dashboard", "openChat"),
      desc: t("dashboard", "openChatDesc"),
    });
  }
  if (owner) {
    features.push({
      key: "platform",
      href: "/platform",
      title: t("dashboard", "platformAdmin"),
      desc: t("dashboard", "platformAdminDesc"),
    });
  }

  return (
    <View style={[s.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[s.header, { flexDirection: rowDir }]}>
        <Text style={[s.title, { textAlign }]}>{t("dashboard", "title")}</Text>
        <View style={[s.switchers, { flexDirection: rowDir }]}>
          <LanguageSwitcher />
          <ThemeToggle />
        </View>
      </View>

      <ScrollView style={s.flex} contentContainerStyle={s.scroll}>
        <Text style={[s.signedIn, { textAlign }]}>
          {t("dashboard", "signedInAs")}: <Text style={s.email}>{session.user.email}</Text>
        </Text>

        <Text style={[s.sectionTitle, { textAlign }]}>{t("dashboard", "organizations")}</Text>

        {state.status === "loading" && (
          <View style={s.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        )}

        {state.status === "error" && (
          <View style={s.errorBox}>
            <Text style={[s.errorText, { textAlign }]}>{state.message}</Text>
          </View>
        )}

        {state.status === "ok" && (
          <>
            {state.orgs.length === 0 ? (
              <Text style={[s.muted, { textAlign }]}>{t("dashboard", "noOrganizations")}</Text>
            ) : (
              state.orgs.map((org) => (
                <View key={org.organizationId} style={s.card}>
                  <Text style={[s.orgName, { textAlign }]}>{org.organizationName}</Text>
                  <Text style={[s.roles, { textAlign }]}>
                    {t("dashboard", "roles")}:{" "}
                    {org.roles.length > 0
                      ? org.roles.map((role) => role.name).join(", ")
                      : t("dashboard", "noRoles")}
                  </Text>
                </View>
              ))
            )}

            {features.length > 0 && (
              <>
                <Text style={[s.sectionTitle, { textAlign }]}>{t("dashboard", "features")}</Text>
                {features.map((f) => (
                  <Pressable
                    key={f.key}
                    accessibilityRole="button"
                    onPress={() => router.push(f.href)}
                    style={({ pressed }) => [s.navCard, { flexDirection: rowDir }, pressed && s.pressed]}
                  >
                    <View style={s.navTextWrap}>
                      <Text style={[s.navTitle, { textAlign }]}>{f.title}</Text>
                      <Text style={[s.navDesc, { textAlign }]}>{f.desc}</Text>
                    </View>
                    <Text style={s.chevron}>{isRTL ? "‹" : "›"}</Text>
                  </Pressable>
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        disabled={loggingOut}
        onPress={handleLogout}
        style={({ pressed }) => [s.logout, (pressed || loggingOut) && s.pressed]}
      >
        {loggingOut ? (
          <ActivityIndicator color={colors.foreground} />
        ) : (
          <Text style={s.logoutText}>{t("dashboard", "logout")}</Text>
        )}
      </Pressable>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, paddingHorizontal: 24, backgroundColor: c.background, gap: 10 },
    flex: { flex: 1 },
    scroll: { gap: 12, paddingVertical: 4 },
    header: { alignItems: "center", justifyContent: "space-between", gap: 8 },
    switchers: { alignItems: "center", gap: 8 },
    title: { color: c.foreground, fontSize: 26, fontWeight: "800" },
    signedIn: { color: c.mutedForeground, fontSize: 15 },
    email: { color: c.foreground, fontWeight: "600" },
    sectionTitle: { color: c.foreground, fontSize: 18, fontWeight: "700", marginTop: 8 },
    center: { paddingVertical: 24, alignItems: "center" },
    muted: { color: c.mutedForeground, fontSize: 14 },
    card: {
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card,
      borderRadius: 12,
      padding: 16,
      gap: 4,
    },
    orgName: { color: c.foreground, fontSize: 16, fontWeight: "700" },
    roles: { color: c.mutedForeground, fontSize: 14 },
    navCard: {
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card,
      borderRadius: 12,
      padding: 16,
      alignItems: "center",
      gap: 12,
    },
    navTextWrap: { flex: 1, gap: 3 },
    navTitle: { color: c.foreground, fontSize: 16, fontWeight: "700" },
    navDesc: { color: c.mutedForeground, fontSize: 13, lineHeight: 18 },
    chevron: { color: c.mutedForeground, fontSize: 24, fontWeight: "600" },
    errorBox: {
      borderWidth: 1,
      borderColor: c.destructive,
      backgroundColor: c.card,
      borderRadius: 12,
      padding: 16,
    },
    errorText: { color: c.destructive, fontSize: 13, lineHeight: 18 },
    pressed: { opacity: 0.7 },
    logout: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: "center",
    },
    logoutText: { color: c.foreground, fontSize: 16, fontWeight: "700" },
  });
}
