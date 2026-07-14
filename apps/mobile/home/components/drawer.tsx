/**
 * Provisional side drawer — a minimal modal list keeping the EXISTING feature
 * screens (members / chat / platform) reachable from the Home shell until the
 * bottom tabs are wired for real. Links are gated exactly as those screens
 * already are: members/chat need an organization, platform needs owner. This
 * gating is navigation UX only — each destination screen enforces its own
 * access, as before. The polished drawer replaces this later.
 */
import { useMemo } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "@/lib/locale-context";
import { useTheme, type ThemeColors } from "@/lib/theme-context";
import { radius, space, text } from "@/lib/tokens";
import type { HomeCapabilities } from "../cards";

interface HomeDrawerProps {
  visible: boolean;
  onClose: () => void;
  caps: HomeCapabilities;
}

export function HomeDrawer({ visible, onClose, caps }: HomeDrawerProps) {
  const { t, isRTL } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const textAlign = isRTL ? "right" : "left";
  const rowDir = isRTL ? "row-reverse" : "row";

  const links: { id: string; label: string; href: Href }[] = [];
  if (caps.hasOrganization) {
    links.push(
      { id: "members", label: t("dashboard", "manageMembers"), href: "/members" },
      { id: "chat", label: t("dashboard", "openChat"), href: "/chat" }
    );
  }
  if (caps.owner) {
    links.push({ id: "platform", label: t("dashboard", "platformAdmin"), href: "/platform" });
  }

  const go = (href: Href) => {
    onClose();
    router.push(href);
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <Pressable accessibilityRole="button" style={s.backdrop} onPress={onClose} />
        <View
          style={[
            s.panel,
            isRTL ? s.panelEnd : s.panelStart,
            { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg },
          ]}
        >
          <Text style={[s.title, { textAlign }]}>{t("home", "drawerTitle")}</Text>
          <Text style={[s.provisional, { textAlign }]}>{t("home", "drawerProvisional")}</Text>

          <View style={s.list}>
            {links.map((link) => (
              <Pressable
                key={link.id}
                accessibilityRole="button"
                onPress={() => go(link.href)}
                style={({ pressed }) => [s.row, { flexDirection: rowDir }, pressed && s.pressed]}
              >
                <Text style={[s.rowLabel, { textAlign }]}>{link.label}</Text>
                <Text style={s.chevron}>{isRTL ? "‹" : "›"}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    overlay: { flex: 1 },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: c.foreground,
      opacity: 0.35,
    },
    panel: {
      position: "absolute",
      top: 0,
      bottom: 0,
      width: "78%",
      backgroundColor: c.background,
      paddingHorizontal: space.lg,
      gap: space.sm,
      shadowColor: c.foreground,
      shadowOpacity: 0.2,
      shadowRadius: radius.xl,
      shadowOffset: { width: 0, height: 0 },
      elevation: 12,
    },
    panelStart: { left: 0, borderTopRightRadius: radius.xl, borderBottomRightRadius: radius.xl },
    panelEnd: { right: 0, borderTopLeftRadius: radius.xl, borderBottomLeftRadius: radius.xl },
    title: { color: c.foreground, fontSize: text.xl, fontWeight: "800" },
    provisional: { color: c.mutedForeground, fontSize: text.xs, lineHeight: text.xs * 1.5 },
    list: { marginTop: space.md, gap: space.sm },
    row: {
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: c.card,
      borderRadius: radius.lg + radius.sm,
      paddingHorizontal: space.md,
      paddingVertical: space.md,
      gap: space.sm,
    },
    rowLabel: { flex: 1, color: c.cardForeground, fontSize: text.base, fontWeight: "600" },
    chevron: { color: c.mutedForeground, fontSize: text.xl, fontWeight: "600" },
    pressed: { opacity: 0.7 },
  });
}
