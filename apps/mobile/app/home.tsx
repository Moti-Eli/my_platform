import { useEffect, useState } from "react";
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
import { isRTL, t } from "@/lib/i18n";

/**
 * Authenticated screen. Proves the shared @platform/auth membership resolution
 * works on mobile (same as the web dashboard): shows the user's email and their
 * organization(s) + role(s), with a logout button.
 */
type OrgState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; orgs: UserOrganization[] };

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session } = useAuth();
  const [orgState, setOrgState] = useState<OrgState>({ status: "loading" });
  const [loggingOut, setLoggingOut] = useState(false);

  const userId = session?.user.id;
  const textAlign = isRTL ? "right" : "left";

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
    <View style={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <Stack.Screen options={{ title: t("dashboard", "title") }} />

      <Text style={[styles.title, { textAlign }]}>{t("dashboard", "title")}</Text>

      <Text style={[styles.signedIn, { textAlign }]}>
        {t("dashboard", "signedInAs")}:{" "}
        <Text style={styles.email}>{session.user.email}</Text>
      </Text>

      <Text style={[styles.sectionTitle, { textAlign }]}>{t("dashboard", "organizations")}</Text>

      {orgState.status === "loading" && (
        <View style={styles.center}>
          <ActivityIndicator color="#7c8cff" />
        </View>
      )}

      {orgState.status === "error" && (
        <View style={styles.errorBox}>
          <Text style={[styles.errorText, { textAlign }]}>{orgState.message}</Text>
        </View>
      )}

      {orgState.status === "ok" && (
        <ScrollView style={styles.flex} contentContainerStyle={styles.listContent}>
          {orgState.orgs.length === 0 ? (
            <Text style={[styles.muted, { textAlign }]}>{t("dashboard", "noOrganizations")}</Text>
          ) : (
            orgState.orgs.map((org) => (
              <View key={org.organizationId} style={styles.card}>
                <Text style={[styles.orgName, { textAlign }]}>{org.organizationName}</Text>
                <Text style={[styles.roles, { textAlign }]}>
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
        style={({ pressed }) => [styles.logout, (pressed || loggingOut) && styles.logoutPressed]}
      >
        {loggingOut ? (
          <ActivityIndicator color="#f5f5f7" />
        ) : (
          <Text style={styles.logoutText}>{t("dashboard", "logout")}</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24, backgroundColor: "#0b0b0f", gap: 10 },
  flex: { flex: 1 },
  title: { color: "#f5f5f7", fontSize: 28, fontWeight: "800" },
  signedIn: { color: "#a1a1aa", fontSize: 15 },
  email: { color: "#f5f5f7", fontWeight: "600" },
  sectionTitle: { color: "#e4e4e7", fontSize: 18, fontWeight: "700", marginTop: 8 },
  center: { paddingVertical: 24, alignItems: "center" },
  listContent: { gap: 12, paddingVertical: 4 },
  card: {
    borderWidth: 1,
    borderColor: "#26262e",
    backgroundColor: "#141419",
    borderRadius: 12,
    padding: 16,
    gap: 4,
  },
  orgName: { color: "#f5f5f7", fontSize: 16, fontWeight: "700" },
  roles: { color: "#a1a1aa", fontSize: 14 },
  muted: { color: "#a1a1aa", fontSize: 14 },
  errorBox: {
    borderWidth: 1,
    borderColor: "#7f1d1d",
    backgroundColor: "#1f1113",
    borderRadius: 12,
    padding: 16,
  },
  errorText: { color: "#fca5a5", fontSize: 13, lineHeight: 18 },
  logout: {
    borderWidth: 1,
    borderColor: "#3f3f46",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  logoutPressed: { opacity: 0.7 },
  logoutText: { color: "#f5f5f7", fontSize: 16, fontWeight: "700" },
});
