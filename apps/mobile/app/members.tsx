import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
import { adminApi } from "@/lib/admin-api";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/locale-context";
import { useTheme, type ThemeColors } from "@/lib/theme-context";

/**
 * Members management — mobile parity with web's dashboard/members.
 *
 * VIEW + CHANGE ROLE run directly through the authenticated RN client (RLS is
 * the enforcer). ADD USER (Part B) goes through the web admin API
 * (`/api/admin/members`, ARCHITECTURE.md #26) because creating an auth user
 * needs the secret key — which mobile must never hold; the server re-checks
 * `members.manage` before acting. The "Add user" entry is shown only to users
 * who can manage members (UX; the server is the real boundary).
 */
type OrgRoleRow = { id: string; name: string; is_admin: boolean };
type TargetRole = "admin" | "member";

type Phase =
  | { status: "loading" }
  | { status: "noOrg" }
  | { status: "error"; message: string }
  | { status: "ready"; orgId: string; canManage: boolean; adminRole: OrgRoleRow; memberRole: OrgRoleRow };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LEN = 200;

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
  const { t, tk, isRTL } = useI18n();
  const { colors } = useTheme();

  const [phase, setPhase] = useState<Phase>({ status: "loading" });
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // Add-user modal state.
  const [addOpen, setAddOpen] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addName, setAddName] = useState("");
  const [addRole, setAddRole] = useState<TargetRole>("member");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const s = useMemo(() => makeStyles(colors), [colors]);
  const textAlign = isRTL ? "right" : "left";
  const rowDir = isRTL ? "row-reverse" : "row";
  const currentUserId = session?.user.id;

  const reloadMembers = useCallback(async (orgId: string) => {
    if (!supabase) return;
    const fresh = await getOrganizationMembers(supabase, orgId);
    setMembers(fresh);
  }, []);

  // 401 from the admin API (or no session) means the session is dead: sign out
  // locally and route to login.
  const handleSessionExpired = useCallback(async () => {
    await supabase?.auth.signOut();
    router.replace("/login");
  }, [router]);

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

  const openAdd = useCallback(() => {
    setAddEmail("");
    setAddName("");
    setAddRole("member");
    setAddError(null);
    setAddOpen(true);
  }, []);

  const submitAdd = useCallback(async () => {
    if (phase.status !== "ready" || adding) return;
    const email = addEmail.trim();
    const displayName = addName.trim();
    // Client-side validation for UX — the server remains the boundary.
    if (!EMAIL_RE.test(email)) {
      setAddError(tk("members", "invalidEmail"));
      return;
    }
    if (displayName.length === 0 || addName.length > MAX_NAME_LEN) {
      setAddError(tk("members", "invalidName"));
      return;
    }

    setAdding(true);
    setAddError(null);
    const res = await adminApi.addMember({
      email,
      displayName,
      targetRole: addRole,
      organizationId: phase.orgId,
    });
    setAdding(false);

    if (res.ok) {
      setAddOpen(false);
      await reloadMembers(phase.orgId);
      // Dev-only temp-password hint (mirrors the web NODE_ENV gate).
      if (__DEV__) Alert.alert(t("members", "addUser"), t("members", "tempPasswordNotice"));
      return;
    }
    if (res.kind === "sessionExpired") {
      setAddOpen(false);
      await handleSessionExpired();
      return;
    }
    setAddError(
      res.errorKey === "connectivity" ? t("common", "connectivity") : tk("members", res.errorKey)
    );
  }, [phase, adding, addEmail, addName, addRole, reloadMembers, handleSessionExpired, t, tk]);

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
        {canManage && (
          <Pressable
            accessibilityRole="button"
            onPress={openAdd}
            style={({ pressed }) => [s.addBtn, pressed && s.pressed]}
          >
            <Text style={s.addBtnText}>＋ {t("members", "addUser")}</Text>
          </Pressable>
        )}
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

          {/* Add-user modal */}
          <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
            <KeyboardAvoidingView
              style={s.modalOverlay}
              behavior={Platform.OS === "ios" ? "padding" : undefined}
            >
              <View style={[s.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
                <Text style={[s.modalTitle, { textAlign }]}>{t("members", "addUser")}</Text>
                <Text style={[s.modalSubtitle, { textAlign }]}>{t("members", "addUserSubtitle")}</Text>

                <Text style={[s.label, { textAlign }]}>{t("members", "fieldEmail")}</Text>
                <TextInput
                  style={[s.input, { textAlign }]}
                  value={addEmail}
                  onChangeText={setAddEmail}
                  placeholder={t("members", "fieldEmailPlaceholder")}
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  inputMode="email"
                  editable={!adding}
                />

                <Text style={[s.label, { textAlign }]}>{t("members", "fieldName")}</Text>
                <TextInput
                  style={[s.input, { textAlign }]}
                  value={addName}
                  onChangeText={setAddName}
                  placeholder={t("members", "fieldNamePlaceholder")}
                  placeholderTextColor={colors.mutedForeground}
                  maxLength={MAX_NAME_LEN}
                  editable={!adding}
                />

                <Text style={[s.label, { textAlign }]}>{t("members", "fieldRole")}</Text>
                <View style={[s.roleToggle, { flexDirection: rowDir }]}>
                  {(["admin", "member"] as TargetRole[]).map((r) => {
                    const active = addRole === r;
                    return (
                      <Pressable
                        key={r}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        onPress={() => setAddRole(r)}
                        style={[s.rolePill, active && s.rolePillActive]}
                      >
                        <Text style={[s.rolePillText, active && s.rolePillTextActive]}>
                          {r === "admin" ? t("members", "roleAdmin") : t("members", "roleMember")}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {__DEV__ && (
                  <Text style={[s.devNote, { textAlign }]}>{t("members", "tempPasswordNotice")}</Text>
                )}
                {addError && <Text style={[s.errorText, { textAlign }]}>{addError}</Text>}

                <View style={[s.modalActions, { flexDirection: rowDir }]}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={adding}
                    onPress={() => setAddOpen(false)}
                    style={({ pressed }) => [s.cancelBtn, pressed && s.pressed]}
                  >
                    <Text style={s.cancelText}>{t("members", "cancel")}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={adding}
                    onPress={submitAdd}
                    style={({ pressed }) => [s.submitBtn, (pressed || adding) && s.pressed]}
                  >
                    {adding ? (
                      <ActivityIndicator color={colors.primaryForeground} />
                    ) : (
                      <Text style={s.submitText}>{t("members", "addUserSubmit")}</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            </KeyboardAvoidingView>
          </Modal>
        </>
      )}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background, paddingHorizontal: 16 },
    headerRow: { alignItems: "center", justifyContent: "space-between" },
    backBtn: { paddingVertical: 6, paddingHorizontal: 4 },
    backText: { color: c.primary, fontSize: 15, fontWeight: "600" },
    addBtn: { backgroundColor: c.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
    addBtnText: { color: c.primaryForeground, fontSize: 14, fontWeight: "700" },
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
    // Modal
    modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
    modalSheet: {
      backgroundColor: c.background,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 20,
      paddingTop: 20,
      gap: 8,
    },
    modalTitle: { color: c.foreground, fontSize: 20, fontWeight: "800" },
    modalSubtitle: { color: c.mutedForeground, fontSize: 13, lineHeight: 18, marginBottom: 6 },
    label: { color: c.foreground, fontSize: 13, fontWeight: "600", marginTop: 6 },
    input: {
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 11,
      color: c.foreground,
      fontSize: 16,
    },
    roleToggle: { gap: 8, marginTop: 2 },
    rolePill: {
      flex: 1,
      alignItems: "center",
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 12,
      paddingVertical: 10,
    },
    rolePillActive: { backgroundColor: c.primary, borderColor: c.primary },
    rolePillText: { color: c.foreground, fontSize: 14, fontWeight: "600" },
    rolePillTextActive: { color: c.primaryForeground },
    devNote: { color: c.mutedForeground, fontSize: 12, fontStyle: "italic", marginTop: 6, lineHeight: 17 },
    modalActions: { gap: 10, marginTop: 14 },
    cancelBtn: {
      flex: 1,
      alignItems: "center",
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 12,
      paddingVertical: 13,
    },
    cancelText: { color: c.foreground, fontSize: 15, fontWeight: "700" },
    submitBtn: {
      flex: 1,
      alignItems: "center",
      backgroundColor: c.primary,
      borderRadius: 12,
      paddingVertical: 13,
    },
    submitText: { color: c.primaryForeground, fontSize: 15, fontWeight: "700" },
  });
}
