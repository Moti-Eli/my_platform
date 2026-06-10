import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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
import { getOrganizationMembers, getUserOrganizations } from "@platform/auth";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/locale-context";
import { useTheme, type ThemeColors } from "@/lib/theme-context";

/**
 * Realtime org chat — mobile parity with web's dashboard/chat. Same `messages`
 * table, same RLS: reads/writes go through the AUTHENTICATED RN client, so
 * tenant isolation (members-only SELECT) and anti-forgery (`sender_id =
 * auth.uid()`) are enforced by the database. The realtime socket carries only
 * rows this user may SELECT — a tampered filter still can't leak another org.
 */
const HISTORY_LIMIT = 50;

interface ChatMessage {
  id: string;
  senderId: string;
  content: string;
  createdAt: string;
}

type MessageRow = {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
};

function toMessage(row: MessageRow): ChatMessage {
  return { id: row.id, senderId: row.sender_id, content: row.content, createdAt: row.created_at };
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

type ConnStatus = "connecting" | "live" | "error";

type Phase =
  | { status: "loading" }
  | { status: "noOrg" }
  | { status: "error"; message: string }
  | { status: "ready"; orgId: string; directory: Record<string, string> };

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session } = useAuth();
  const { t, isRTL } = useI18n();
  const { colors } = useTheme();

  const [phase, setPhase] = useState<Phase>({ status: "loading" });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const [conn, setConn] = useState<ConnStatus>("connecting");

  const seenIds = useRef<Set<string>>(new Set());
  const scrollRef = useRef<ScrollView>(null);

  const s = useMemo(() => makeStyles(colors), [colors]);
  const textAlign = isRTL ? "right" : "left";
  const currentUserId = session?.user.id;

  const addMessage = useCallback((m: ChatMessage) => {
    if (seenIds.current.has(m.id)) return; // de-dupe (e.g. our own realtime echo)
    seenIds.current.add(m.id);
    setMessages((prev) => [...prev, m]);
  }, []);

  // Resolve org → load history + directory → subscribe to realtime INSERTs.
  useEffect(() => {
    if (!supabase || !currentUserId) return;
    const client = supabase;
    let active = true;
    let channel: ReturnType<typeof client.channel> | null = null;

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

        // Member directory resolves sender names for realtime rows (which carry
        // only raw columns, no join).
        const members = await getOrganizationMembers(client, orgId);
        if (!active) return;
        const directory: Record<string, string> = {};
        for (const member of members) {
          directory[member.userId] = member.displayName?.trim() || member.email;
        }

        const { data, error } = await client
          .from("messages")
          .select("id, sender_id, content, created_at")
          .eq("organization_id", orgId)
          .order("created_at", { ascending: false })
          .limit(HISTORY_LIMIT);
        if (!active) return;
        if (error) {
          setPhase({ status: "error", message: t("chat", "loadError") });
          return;
        }

        const initial = ((data ?? []) as MessageRow[]).map(toMessage).reverse();
        seenIds.current = new Set(initial.map((m) => m.id));
        setMessages(initial);
        setPhase({ status: "ready", orgId, directory });

        // Authenticate the socket as this user so RLS applies on the channel.
        const { data: sessionData } = await client.auth.getSession();
        if (!active) return;
        if (sessionData.session) {
          await client.realtime.setAuth(sessionData.session.access_token);
        }
        if (!active) return;

        channel = client
          .channel(`org-chat:${orgId}`)
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "messages", filter: `organization_id=eq.${orgId}` },
            (payload) => {
              addMessage(toMessage(payload.new as MessageRow));
            }
          )
          .subscribe((status) => {
            if (!active) return;
            if (status === "SUBSCRIBED") setConn("live");
            else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setConn("error");
            else setConn("connecting");
          });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (active) setPhase({ status: "error", message });
      }
    })();

    return () => {
      active = false;
      if (channel) client.removeChannel(channel);
    };
  }, [currentUserId, addMessage, t]);

  async function send() {
    if (phase.status !== "ready" || !supabase || !currentUserId) return;
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setSendError(false);
    // Post through the AUTHENTICATED client: `sender_id = auth.uid()` RLS is the
    // enforcer (a forged sender is impossible). DB row is the source of truth.
    const { data, error } = await supabase
      .from("messages")
      .insert({ organization_id: phase.orgId, sender_id: currentUserId, content })
      .select("id, sender_id, content, created_at")
      .single();
    setSending(false);
    if (error || !data) {
      setSendError(true);
      return;
    }
    setDraft("");
    addMessage(toMessage(data as MessageRow));
  }

  const connLabel =
    conn === "live" ? t("chat", "live") : conn === "error" ? t("chat", "connectionError") : t("chat", "connecting");
  const connColor = conn === "live" ? "#10b981" : conn === "error" ? colors.destructive : colors.mutedForeground;

  return (
    <KeyboardAvoidingView
      style={[s.container, { paddingTop: insets.top + 12 }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={insets.top + 12}
    >
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[s.header, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={({ pressed }) => [s.backBtn, pressed && s.pressed]}
        >
          <Text style={s.backText}>{isRTL ? `${t("chat", "backToDashboard")} ›` : `‹ ${t("chat", "backToDashboard")}`}</Text>
        </Pressable>
        {phase.status === "ready" && (
          <View style={[s.connPill, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
            <View style={[s.connDot, { backgroundColor: connColor }]} />
            <Text style={[s.connText, { color: connColor }]}>{connLabel}</Text>
          </View>
        )}
      </View>
      <Text style={[s.title, { textAlign }]}>{t("chat", "title")}</Text>

      {phase.status === "loading" && (
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}

      {phase.status === "noOrg" && (
        <View style={s.center}>
          <Text style={[s.muted, { textAlign: "center" }]}>{t("chat", "noOrganization")}</Text>
        </View>
      )}

      {phase.status === "error" && (
        <View style={s.center}>
          <Text style={[s.errorText, { textAlign: "center" }]}>{phase.message}</Text>
        </View>
      )}

      {phase.status === "ready" && (
        <>
          <ScrollView
            ref={scrollRef}
            style={s.flex}
            contentContainerStyle={s.messages}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
            keyboardShouldPersistTaps="handled"
          >
            {messages.length === 0 ? (
              <View style={s.center}>
                <Text style={[s.muted, { textAlign: "center" }]}>{t("chat", "empty")}</Text>
              </View>
            ) : (
              messages.map((m) => {
                const isOwn = m.senderId === currentUserId;
                const name = isOwn
                  ? t("chat", "you")
                  : phase.directory[m.senderId] ?? t("chat", "unknownSender");
                const ownSide = isRTL ? "flex-start" : "flex-end";
                const otherSide = isRTL ? "flex-end" : "flex-start";
                return (
                  <View key={m.id} style={{ alignItems: isOwn ? ownSide : otherSide }}>
                    <View style={s.bubbleWrap}>
                      {!isOwn && <Text style={[s.senderName, { textAlign }]}>{name}</Text>}
                      <View style={[s.bubble, isOwn ? s.bubbleOwn : s.bubbleOther]}>
                        <Text style={[isOwn ? s.bubbleTextOwn : s.bubbleTextOther, { textAlign }]}>
                          {m.content}
                        </Text>
                      </View>
                      <Text style={[s.time, { textAlign }]}>{formatTime(m.createdAt)}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>

          {/* Composer */}
          <View style={[s.composer, { paddingBottom: insets.bottom + 8 }]}>
            {sendError && <Text style={[s.sendError, { textAlign }]}>{t("chat", "sendError")}</Text>}
            <View style={[s.composerRow, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
              <TextInput
                style={[s.input, { textAlign }]}
                value={draft}
                onChangeText={setDraft}
                placeholder={t("chat", "placeholder")}
                placeholderTextColor={colors.mutedForeground}
                maxLength={2000}
                multiline
                editable={!sending}
                onSubmitEditing={send}
                returnKeyType="send"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("chat", "send")}
                disabled={sending || draft.trim().length === 0}
                onPress={send}
                style={({ pressed }) => [
                  s.sendBtn,
                  (sending || draft.trim().length === 0) && s.sendBtnDisabled,
                  pressed && s.pressed,
                ]}
              >
                {sending ? (
                  <ActivityIndicator color={colors.primaryForeground} size="small" />
                ) : (
                  <Text style={s.sendBtnText}>{t("chat", "send")}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background, paddingHorizontal: 16 },
    header: { alignItems: "center", justifyContent: "space-between" },
    backBtn: { paddingVertical: 6, paddingHorizontal: 4 },
    backText: { color: c.primary, fontSize: 15, fontWeight: "600" },
    pressed: { opacity: 0.6 },
    connPill: { alignItems: "center", gap: 6 },
    connDot: { width: 8, height: 8, borderRadius: 4 },
    connText: { fontSize: 12, fontWeight: "600" },
    title: { color: c.foreground, fontSize: 24, fontWeight: "800", marginTop: 2, marginBottom: 8 },
    flex: { flex: 1 },
    center: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 40 },
    muted: { color: c.mutedForeground, fontSize: 14, lineHeight: 20 },
    errorText: { color: c.destructive, fontSize: 14, lineHeight: 20 },
    messages: { gap: 10, paddingVertical: 8, flexGrow: 1 },
    bubbleWrap: { maxWidth: "80%", gap: 2 },
    senderName: { color: c.mutedForeground, fontSize: 12, fontWeight: "600", paddingHorizontal: 4 },
    bubble: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 9 },
    bubbleOwn: { backgroundColor: c.primary, borderBottomRightRadius: 4 },
    bubbleOther: { backgroundColor: c.muted, borderBottomLeftRadius: 4 },
    bubbleTextOwn: { color: c.primaryForeground, fontSize: 15, lineHeight: 21 },
    bubbleTextOther: { color: c.foreground, fontSize: 15, lineHeight: 21 },
    time: { color: c.mutedForeground, fontSize: 10, paddingHorizontal: 4 },
    composer: { borderTopWidth: 1, borderTopColor: c.border, paddingTop: 8, gap: 6 },
    composerRow: { alignItems: "flex-end", gap: 8 },
    sendError: { color: c.destructive, fontSize: 12, paddingHorizontal: 4 },
    input: {
      flex: 1,
      minHeight: 44,
      maxHeight: 120,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 10,
      color: c.foreground,
      fontSize: 15,
    },
    sendBtn: {
      backgroundColor: c.primary,
      borderRadius: 14,
      paddingHorizontal: 18,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    sendBtnDisabled: { opacity: 0.5 },
    sendBtnText: { color: c.primaryForeground, fontSize: 15, fontWeight: "700" },
  });
}
