import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Redirect, Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getUserOrganizations, signOut, type UserOrganization } from "@platform/auth";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/locale-context";
import { useTheme, type ThemeColors } from "@/lib/theme-context";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Authenticated screen. Proves the shared @platform/auth membership resolution
 * works on mobile (same as the web dashboard): shows the user's email and their
 * organization(s) + role(s), with language/theme switchers and a logout button.
 */
type OrgState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; orgs: UserOrganization[] };

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session } = useAuth();
  const { t, isRTL } = useI18n();
  const { colors } = useTheme();
  const [orgState, setOrgState] = useState<OrgState>({ status: "loading" });
  const [loggingOut, setLoggingOut] = useState(false);

  const s = useMemo(() => makeStyles(colors), [colors]);
  const userId = session?.user.id;
  const textAlign = isRTL ? "right" : "left";
  const rowDir = isRTL ? "row-reverse" : "row";

  useEffect(() => {
    if (!supabase || !userId) return;
    let active = true;
    setOrgState({ status: "loading" });

    getUserOrganizations(supabase, userId)
      .then((orgs) => {
        if (active) setOrgState({ status: "ok", orgs });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        if (active) setOrgState({ status: "error", message });
      });

    return () => {
      active = false;
    };
  }, [userId]);

  async function handleLogout() {
    if (loggingOut || !supabase) return;
    setLoggingOut(true);
    try {
      await signOut(supabase);
      router.replace("/login");
    } finally {
      setLoggingOut(false);
    }
  }

  // If the session is gone (e.g. logout elsewhere), bounce to login.
  if (!session) {
    return <Redirect href="/login" />;
  }

  return (
    <View style={[s.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <Stack.Screen options={{ title: t("dashboard", "title") }} />

      <View style={[s.header, { flexDirection: rowDir }]}>
        <Text style={[s.title, { textAlign }]}>{t("dashboard", "title")}</Text>
        <View style={[s.switchers, { flexDirection: rowDir }]}>
          <LanguageSwitcher />
          <ThemeToggle />
        </View>
      </View>

      <Text style={[s.signedIn, { textAlign }]}>
        {t("dashboard", "signedInAs")}:{" "}
        <Text style={s.email}>{session.user.email}</Text>
      </Text>

      <Text style={[s.sectionTitle, { textAlign }]}>{t("dashboard", "organizations")}</Text>

      {orgState.status === "loading" && (
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}

      {orgState.status === "error" && (
        <View style={s.errorBox}>
          <Text style={[s.errorText, { textAlign }]}>{orgState.message}</Text>
        </View>
      )}

      {orgState.status === "ok" && (
        <ScrollView style={s.flex} contentContainerStyle={s.listContent}>
          {orgState.orgs.length === 0 ? (
            <Text style={[s.muted, { textAlign }]}>{t("dashboard", "noOrganizations")}</Text>
          ) : (
            orgState.orgs.map((org) => (
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
        </ScrollView>
      )}

      <Pressable
        accessibilityRole="button"
        disabled={loggingOut}
        onPress={handleLogout}
        style={({ pressed }) => [s.logout, (pressed || loggingOut) && s.logoutPressed]}
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
    header: { alignItems: "center", justifyContent: "space-between", gap: 8 },
    switchers: { alignItems: "center", gap: 8 },
    title: { color: c.foreground, fontSize: 26, fontWeight: "800" },
    signedIn: { color: c.mutedForeground, fontSize: 15 },
    email: { color: c.foreground, fontWeight: "600" },
    sectionTitle: { color: c.foreground, fontSize: 18, fontWeight: "700", marginTop: 8 },
    center: { paddingVertical: 24, alignItems: "center" },
    listContent: { gap: 12, paddingVertical: 4 },
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
    muted: { color: c.mutedForeground, fontSize: 14 },
    errorBox: {
      borderWidth: 1,
      borderColor: c.destructive,
      backgroundColor: c.card,
      borderRadius: 12,
      padding: 16,
    },
    errorText: { color: c.destructive, fontSize: 13, lineHeight: 18 },
    logout: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: "center",
      marginTop: 4,
    },
    logoutPressed: { opacity: 0.7 },
    logoutText: { color: c.foreground, fontSize: 16, fontWeight: "700" },
  });
}
