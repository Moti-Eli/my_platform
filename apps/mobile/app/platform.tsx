import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Redirect, Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isPlatformOwner } from "@platform/auth";
import { supabase } from "@/lib/supabase";
import { adminApi, type OrgListItem } from "@/lib/admin-api";
import { useI18n } from "@/lib/locale-context";
import { useTheme, type ThemeColors } from "@/lib/theme-context";

/**
 * Platform-owner screen — mobile parity with web's /platform.
 *
 * The all-orgs list and org creation both need the secret key (RLS approach (b):
 * the publishable client can't read across orgs, and creating an org + first
 * admin needs service_role), so they run through the web admin API
 * (`/api/admin/organizations`, ARCHITECTURE.md #26). The server re-verifies
 * `isPlatformOwner`; the client guard here is only UX.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LEN = 200;

type Phase =
  | { status: "loading" }
  | { status: "notOwner" }
  | { status: "error"; message: string }
  | { status: "ready"; orgs: OrgListItem[] };

function formatDate(iso: string): string {
  const d = new Date(iso);
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  const dd = d.getDate().toString().padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export default function PlatformScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, tk, isRTL } = useI18n();
  const { colors } = useTheme();

  const [phase, setPhase] = useState<Phase>({ status: "loading" });

  const [createOpen, setCreateOpen] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // Synchronous re-entrancy guard: `creating` state is stale across two taps
  // fired before re-render, so a ref is what actually prevents a double submit.
  const createBusyRef = useRef(false);

  const s = useMemo(() => makeStyles(colors), [colors]);
  const textAlign = isRTL ? "right" : "left";
  const rowDir = isRTL ? "row-reverse" : "row";

  const handleSessionExpired = useCallback(async () => {
    await supabase?.auth.signOut();
    router.replace("/login");
  }, [router]);

  const loadOrgs = useCallback(async () => {
    const res = await adminApi.listOrganizations();
    if (res.ok) {
      setPhase({ status: "ready", orgs: res.data.organizations });
      return;
    }
    if (res.kind === "sessionExpired") {
      await handleSessionExpired();
      return;
    }
    // notAllowed means not a platform owner — bounce to the dashboard.
    if (res.errorKey === "notAllowed") {
      setPhase({ status: "notOwner" });
      return;
    }
    setPhase({
      status: "error",
      message: res.errorKey === "connectivity" ? t("common", "connectivity") : tk("platform", res.errorKey),
    });
  }, [handleSessionExpired, t, tk]);

  useEffect(() => {
    if (!supabase) {
      setPhase({ status: "error", message: t("platform", "dataUnavailable") });
      return;
    }
    let active = true;
    (async () => {
      // Client-side UX guard (the server is the real boundary).
      const owner = await isPlatformOwner(supabase);
      if (!active) return;
      if (!owner) {
        setPhase({ status: "notOwner" });
        return;
      }
      await loadOrgs();
    })();
    return () => {
      active = false;
    };
  }, [loadOrgs, t]);

  const openCreate = useCallback(() => {
    setOrgName("");
    setAdminEmail("");
    setAdminName("");
    setCreateError(null);
    setCreateOpen(true);
  }, []);

  const submitCreate = useCallback(async () => {
    if (createBusyRef.current) return;
    const organizationName = orgName.trim();
    const email = adminEmail.trim();
    const displayName = adminName.trim();
    // Client-side validation for UX — these early returns do no async work, so
    // they leave the busy ref untouched.
    if (organizationName.length === 0 || orgName.length > MAX_NAME_LEN) {
      setCreateError(tk("platform", "invalidOrgName"));
      return;
    }
    if (!EMAIL_RE.test(email)) {
      setCreateError(tk("platform", "invalidEmail"));
      return;
    }
    if (displayName.length === 0 || adminName.length > MAX_NAME_LEN) {
      setCreateError(tk("platform", "invalidName"));
      return;
    }

    createBusyRef.current = true;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await adminApi.createOrganization({
        organizationName,
        adminEmail: email,
        adminDisplayName: displayName,
      });

      if (res.ok) {
        setCreateOpen(false);
        await loadOrgs();
        // Dev-only: surface the first admin's temp password (mirrors web's gate).
        if (__DEV__ && res.data.tempPassword) {
          Alert.alert(
            t("platform", "createdTitle"),
            `${t("platform", "createdEmailLabel")}: ${email}\n${t("platform", "createdTempPasswordLabel")}: ${res.data.tempPassword}`
          );
        }
        return;
      }
      if (res.kind === "sessionExpired") {
        setCreateOpen(false);
        await handleSessionExpired();
        return;
      }
      setCreateError(
        res.errorKey === "connectivity" ? t("common", "connectivity") : tk("platform", res.errorKey)
      );
    } finally {
      createBusyRef.current = false;
      setCreating(false);
    }
  }, [orgName, adminEmail, adminName, loadOrgs, handleSessionExpired, t, tk]);

  if (phase.status === "notOwner") {
    return <Redirect href="/home" />;
  }

  const orgs = phase.status === "ready" ? phase.orgs : [];

  return (
    <View style={[s.container, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[s.headerRow, { flexDirection: rowDir }]}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={({ pressed }) => [s.backBtn, pressed && s.pressed]}
        >
          <Text style={s.backText}>{isRTL ? `${t("platform", "backToDashboard")} ›` : `‹ ${t("platform", "backToDashboard")}`}</Text>
        </Pressable>
        {phase.status === "ready" && (
          <Pressable
            accessibilityRole="button"
            onPress={openCreate}
            style={({ pressed }) => [s.addBtn, pressed && s.pressed]}
          >
            <Text style={s.addBtnText}>＋ {t("platform", "createOrg")}</Text>
          </Pressable>
        )}
      </View>

      <Text style={[s.eyebrow, { textAlign }]}>{t("platform", "ownerBadge")}</Text>
      <Text style={[s.title, { textAlign }]}>{t("platform", "title")}</Text>
      <Text style={[s.subtitle, { textAlign }]}>{t("platform", "subtitle")}</Text>

      {phase.status === "loading" && (
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}

      {phase.status === "error" && (
        <View style={s.center}>
          <Text style={[s.errorText, { textAlign: "center" }]}>{phase.message}</Text>
        </View>
      )}

      {phase.status === "ready" && (
        <ScrollView style={s.flex} contentContainerStyle={s.list}>
          <Text style={[s.statLine, { textAlign }]}>
            {t("platform", "statOrgs")}: {orgs.length}
          </Text>
          {orgs.length === 0 ? (
            <Text style={[s.muted, { textAlign: "center" }]}>{t("platform", "noOrgs")}</Text>
          ) : (
            orgs.map((org) => (
              <View key={org.id} style={[s.card, { flexDirection: rowDir }]}>
                <View style={s.avatar}>
                  <Text style={s.avatarText}>{org.name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={s.orgInfo}>
                  <Text style={[s.orgName, { textAlign }]} numberOfLines={1}>
                    {org.name}
                  </Text>
                  <Text style={[s.orgMeta, { textAlign }]}>
                    {org.memberCount} {t("platform", "colMembers")} · {formatDate(org.createdAt)}
                  </Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {/* Create-organization modal */}
      <Modal visible={createOpen} transparent animationType="slide" onRequestClose={() => setCreateOpen(false)}>
        <KeyboardAvoidingView
          style={s.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={[s.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={[s.modalTitle, { textAlign }]}>{t("platform", "createOrg")}</Text>
            <Text style={[s.modalSubtitle, { textAlign }]}>{t("platform", "createOrgSubtitle")}</Text>

            <Text style={[s.label, { textAlign }]}>{t("platform", "fieldOrgName")}</Text>
            <TextInput
              style={[s.input, { textAlign }]}
              value={orgName}
              onChangeText={setOrgName}
              placeholder={t("platform", "fieldOrgNamePlaceholder")}
              placeholderTextColor={colors.mutedForeground}
              maxLength={MAX_NAME_LEN}
              editable={!creating}
            />

            <Text style={[s.label, { textAlign }]}>{t("platform", "fieldAdminEmail")}</Text>
            <TextInput
              style={[s.input, { textAlign }]}
              value={adminEmail}
              onChangeText={setAdminEmail}
              placeholder={t("platform", "fieldAdminEmailPlaceholder")}
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              inputMode="email"
              editable={!creating}
            />

            <Text style={[s.label, { textAlign }]}>{t("platform", "fieldAdminName")}</Text>
            <TextInput
              style={[s.input, { textAlign }]}
              value={adminName}
              onChangeText={setAdminName}
              placeholder={t("platform", "fieldAdminNamePlaceholder")}
              placeholderTextColor={colors.mutedForeground}
              maxLength={MAX_NAME_LEN}
              editable={!creating}
            />

            {__DEV__ && <Text style={[s.devNote, { textAlign }]}>{t("members", "tempPasswordNotice")}</Text>}
            {createError && <Text style={[s.errorText, { textAlign }]}>{createError}</Text>}

            <View style={[s.modalActions, { flexDirection: rowDir }]}>
              <Pressable
                accessibilityRole="button"
                disabled={creating}
                onPress={() => setCreateOpen(false)}
                style={({ pressed }) => [s.cancelBtn, pressed && s.pressed]}
              >
                <Text style={s.cancelText}>{t("platform", "cancel")}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={creating}
                onPress={submitCreate}
                style={({ pressed }) => [s.submitBtn, (pressed || creating) && s.pressed]}
              >
                {creating ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Text style={s.submitText}>{t("platform", "createOrgSubmit")}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
    eyebrow: {
      color: c.primary,
      fontSize: 12,
      fontWeight: "700",
      letterSpacing: 1,
      textTransform: "uppercase",
      marginTop: 4,
    },
    title: { color: c.foreground, fontSize: 24, fontWeight: "800", marginTop: 2 },
    subtitle: { color: c.mutedForeground, fontSize: 14, lineHeight: 20, marginTop: 2, marginBottom: 10 },
    flex: { flex: 1 },
    center: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 40 },
    muted: { color: c.mutedForeground, fontSize: 14, lineHeight: 20, paddingVertical: 20 },
    errorText: { color: c.destructive, fontSize: 14, lineHeight: 20 },
    statLine: { color: c.mutedForeground, fontSize: 13, fontWeight: "600", marginBottom: 2 },
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
    avatar: {
      width: 38,
      height: 38,
      borderRadius: 10,
      backgroundColor: c.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: { color: c.primaryForeground, fontSize: 16, fontWeight: "800" },
    orgInfo: { flex: 1, gap: 2 },
    orgName: { color: c.foreground, fontSize: 16, fontWeight: "700" },
    orgMeta: { color: c.mutedForeground, fontSize: 13 },
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
