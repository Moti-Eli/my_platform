import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  getOrganizationMembers,
  getUserOrganizations,
  hasPermission,
  type OrgMember,
} from "@platform/auth";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/locale-context";
import { useTheme, type ThemeColors } from "@/lib/theme-context";

/**
 * Members management — mobile parity with web's dashboard/members (VIEW + CHANGE
 * ROLE only; add-user is deferred to part B, which needs a server-side endpoint
 * because mobile can't hold the secret key).
 *
 * Everything runs through the AUTHENTICATED RN client, so the database is the
 * enforcer: the `members.manage` RLS policy gates the role writes (a non-admin
 * is denied), and the last-admin DB trigger blocks stripping an org's last
 * admin. The app-level checks here are just UX — the DB is the real boundary.
 */
type OrgRoleRow = { id: string; name: string; is_admin: boolean };
type TargetRole = "admin" | "member";

type Phase =
  | { status: "loading" }
  | { status: "noOrg" }
  | { status: "error"; message: string }
  | { status: "ready"; orgId: string; canManage: boolean; adminRole: OrgRoleRow; memberRole: OrgRoleRow };

function formatDate(iso: string): string {
  const d = new Date(iso);
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  const dd = d.getDate().toString().padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export default function MembersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session } = useAuth();
  const { t, isRTL } = useI18n();
  const { colors } = useTheme();

  const [phase, setPhase] = useState<Phase>({ status: "loading" });
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const s = useMemo(() => makeStyles(colors), [colors]);
  const textAlign = isRTL ? "right" : "left";
  const rowDir = isRTL ? "row-reverse" : "row";
  const currentUserId = session?.user.id;

  const reloadMembers = useCallback(async (orgId: string) => {
    if (!supabase) return;
    const fresh = await getOrganizationMembers(supabase, orgId);
    setMembers(fresh);
  }, []);

  useEffect(() => {
    if (!supabase || !currentUserId) return;
    const client = supabase;
    let active = true;

    (async () => {
      try {
        const orgs = await getUserOrganizations(client, currentUserId);
        if (!active) return;
        const org = orgs[0];
        if (!org) {
          setPhase({ status: "noOrg" });
          return;
        }
        const orgId = org.organizationId;

        const [canManage, orgMembers, rolesRes] = await Promise.all([
          hasPermission(client, currentUserId, orgId, "members.manage"),
          getOrganizationMembers(client, orgId),
          client.from("roles").select("id, name, is_admin").eq("organization_id", orgId),
        ]);
        if (!active) return;
        if (rolesRes.error) {
          setPhase({ status: "error", message: t("members", "updateFailed") });
          return;
        }
        const roles = (rolesRes.data ?? []) as OrgRoleRow[];
        const adminRole = roles.find((r) => r.is_admin);
        const memberRole =
          roles.find((r) => !r.is_admin && r.name === "Member") ?? roles.find((r) => !r.is_admin);
        if (!adminRole || !memberRole) {
          setPhase({ status: "error", message: t("members", "updateFailed") });
          return;
        }

        setMembers(orgMembers);
        setPhase({ status: "ready", orgId, canManage, adminRole, memberRole });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (active) setPhase({ status: "error", message });
      }
    })();

    return () => {
      active = false;
    };
  }, [currentUserId, t]);

  // Replicates web's updateMemberRoleAction, but called directly from the
  // authenticated RN client (RLS + the last-admin trigger are the enforcers).
  const changeRole = useCallback(
    async (member: OrgMember, targetRole: TargetRole) => {
      if (phase.status !== "ready" || !supabase) return;
      const { orgId, adminRole, memberRole } = phase;

      // App-level last-admin guard (the DB trigger is the real one) — friendly.
      const targetIsAdmin = member.roles.some((r) => r.isAdmin);
      const adminCount = members.filter((m) => m.roles.some((r) => r.isAdmin)).length;
      if (targetRole === "member" && targetIsAdmin && adminCount <= 1) {
        Alert.alert(t("members", "changeRole"), t("members", "cannotRemoveLastAdmin"));
        return;
      }

      const addRoleId = targetRole === "admin" ? adminRole.id : memberRole.id;
      const removeRoleId = targetRole === "admin" ? memberRole.id : adminRole.id;

      setUpdatingId(member.membershipId);
      try {
        const upsert = await supabase
          .from("membership_roles")
          .upsert(
            { membership_id: member.membershipId, role_id: addRoleId, organization_id: orgId },
            { onConflict: "membership_id,role_id", ignoreDuplicates: true }
          );
        if (upsert.error) {
          Alert.alert(t("members", "changeRole"), t("members", "notAllowed"));
          await reloadMembers(orgId);
          return;
        }

        const del = await supabase
          .from("membership_roles")
          .delete()
          .eq("membership_id", member.membershipId)
          .eq("role_id", removeRoleId)
          .eq("organization_id", orgId);
        if (del.error) {
          const lastAdmin = del.error.message.toLowerCase().includes("admin");
          Alert.alert(
            t("members", "changeRole"),
            lastAdmin ? t("members", "cannotRemoveLastAdmin") : t("members", "notAllowed")
          );
          await reloadMembers(orgId);
          return;
        }

        // Reflect DB truth in the UI.
        await reloadMembers(orgId);
      } catch {
        Alert.alert(t("members", "changeRole"), t("members", "updateFailed"));
        await reloadMembers(orgId);
      } finally {
        setUpdatingId(null);
      }
    },
    [phase, members, reloadMembers, t]
  );

  const promptRole = useCallback(
    (member: OrgMember) => {
      const isAdmin = member.roles.some((r) => r.isAdmin);
      const name = member.displayName?.trim() || member.email;
      Alert.alert(t("members", "changeRole"), name, [
        {
          text: t("members", "roleAdmin"),
          onPress: () => {
            if (!isAdmin) void changeRole(member, "admin");
          },
        },
        {
          text: t("members", "roleMember"),
          onPress: () => {
            if (isAdmin) void changeRole(member, "member");
          },
        },
        { text: t("members", "cancel"), style: "cancel" },
      ]);
    },
    [changeRole, t]
  );

  const canManage = phase.status === "ready" && phase.canManage;

  return (
    <View style={[s.container, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[s.headerRow, { flexDirection: rowDir }]}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={({ pressed }) => [s.backBtn, pressed && s.pressed]}
        >
          <Text style={s.backText}>{isRTL ? `${t("members", "backToDashboard")} ›` : `‹ ${t("members", "backToDashboard")}`}</Text>
        </Pressable>
      </View>
      <Text style={[s.title, { textAlign }]}>{t("members", "title")}</Text>
      <Text style={[s.subtitle, { textAlign }]}>{t("members", "subtitle")}</Text>

      {phase.status === "loading" && (
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}

      {phase.status === "noOrg" && (
        <View style={s.center}>
          <Text style={[s.muted, { textAlign: "center" }]}>{t("members", "noOrganization")}</Text>
        </View>
      )}

      {phase.status === "error" && (
        <View style={s.center}>
          <Text style={[s.errorText, { textAlign: "center" }]}>{phase.message}</Text>
        </View>
      )}

      {phase.status === "ready" && (
        <>
          {!canManage && (
            <View style={s.notice}>
              <Text style={[s.noticeText, { textAlign }]}>{t("members", "readOnlyNotice")}</Text>
            </View>
          )}

          <ScrollView style={s.flex} contentContainerStyle={s.list}>
            {members.length === 0 ? (
              <Text style={[s.muted, { textAlign: "center" }]}>{t("members", "noMembers")}</Text>
            ) : (
              members.map((member) => {
                const isAdmin = member.roles.some((r) => r.isAdmin);
                const isYou = member.userId === currentUserId;
                const name = member.displayName?.trim() || member.email;
                const roleLabel = isAdmin ? t("members", "roleAdmin") : t("members", "roleMember");
                const busy = updatingId === member.membershipId;
                return (
                  <View key={member.membershipId} style={[s.card, { flexDirection: rowDir }]}>
                    <View style={s.memberInfo}>
                      <Text style={[s.memberName, { textAlign }]} numberOfLines={1}>
                        {name}
                        {isYou ? `  ·  ${t("members", "you")}` : ""}
                      </Text>
                      {member.displayName?.trim() ? (
                        <Text style={[s.memberEmail, { textAlign }]} numberOfLines={1}>
                          {member.email}
                        </Text>
                      ) : null}
                      <Text style={[s.joined, { textAlign }]}>
                        {t("members", "colJoined")}: {formatDate(member.joinedAt)}
                      </Text>
                    </View>

                    {busy ? (
                      <ActivityIndicator color={colors.primary} />
                    ) : canManage ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("members", "changeRole")}
                        onPress={() => promptRole(member)}
                        style={({ pressed }) => [
                          s.roleBadge,
                          isAdmin ? s.roleBadgeAdmin : s.roleBadgeMember,
                          pressed && s.pressed,
                        ]}
                      >
                        <Text style={[s.roleText, isAdmin ? s.roleTextAdmin : s.roleTextMember]}>
                          {roleLabel} ⌄
                        </Text>
                      </Pressable>
                    ) : (
                      <View style={[s.roleBadge, isAdmin ? s.roleBadgeAdmin : s.roleBadgeMember]}>
                        <Text style={[s.roleText, isAdmin ? s.roleTextAdmin : s.roleTextMember]}>
                          {roleLabel}
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </ScrollView>
        </>
      )}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background, paddingHorizontal: 16 },
    headerRow: { alignItems: "center" },
    backBtn: { paddingVertical: 6, paddingHorizontal: 4 },
    backText: { color: c.primary, fontSize: 15, fontWeight: "600" },
    pressed: { opacity: 0.6 },
    title: { color: c.foreground, fontSize: 24, fontWeight: "800", marginTop: 2 },
    subtitle: { color: c.mutedForeground, fontSize: 14, lineHeight: 20, marginTop: 2, marginBottom: 10 },
    flex: { flex: 1 },
    center: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 40 },
    muted: { color: c.mutedForeground, fontSize: 14, lineHeight: 20 },
    errorText: { color: c.destructive, fontSize: 14, lineHeight: 20 },
    notice: {
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.muted,
      borderRadius: 12,
      padding: 12,
      marginBottom: 10,
    },
    noticeText: { color: c.mutedForeground, fontSize: 13, lineHeight: 18 },
    list: { gap: 10, paddingVertical: 4 },
    card: {
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card,
      borderRadius: 12,
      padding: 14,
      alignItems: "center",
      gap: 12,
    },
    memberInfo: { flex: 1, gap: 2 },
    memberName: { color: c.foreground, fontSize: 16, fontWeight: "700" },
    memberEmail: { color: c.mutedForeground, fontSize: 13 },
    joined: { color: c.mutedForeground, fontSize: 12, marginTop: 2 },
    roleBadge: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1 },
    roleBadgeAdmin: { backgroundColor: c.primary, borderColor: c.primary },
    roleBadgeMember: { backgroundColor: "transparent", borderColor: c.border },
    roleText: { fontSize: 13, fontWeight: "700" },
    roleTextAdmin: { color: c.primaryForeground },
    roleTextMember: { color: c.foreground },
  });
}
