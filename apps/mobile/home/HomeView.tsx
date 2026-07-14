/**
 * Home — design shell. One shared screen for every user; the visible cards are
 * the HOME_CARDS registry filtered by capabilities resolved ONCE on load
 * (isPlatformOwner + effective permissions via @platform/auth). Role never
 * changes the code path, only which cards survive the filter.
 *
 * The date strip, cards and tabs are placeholders with no destinations yet —
 * those interactions float a "coming soon" hint. Two things are REAL so the
 * shell doesn't hide existing functionality: the avatar signs out (confirm →
 * @platform/auth signOut → landing), and the menu opens a provisional drawer
 * linking to the existing members/chat/platform screens (see drawer.tsx).
 * The card filter is UI convenience, NOT a security boundary (see cards.ts).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Animated, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  getEffectivePermissions,
  getUserOrganizations,
  isPlatformOwner,
  signOut,
} from "@platform/auth";
import { captureException } from "@platform/observability";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/lib/locale-context";
import { useTheme, type ThemeColors } from "@/lib/theme-context";
import { radius, space, text } from "@/lib/tokens";
import { filterHomeCards, HOME_CARDS, type HomeCapabilities } from "./cards";
import { ComingSoonCard } from "./components/coming-soon-card";
import { DateStrip } from "./components/date-strip";
import { HomeDrawer } from "./components/drawer";
import { TabBar } from "./components/tab-bar";
import { TopBar } from "./components/top-bar";

const NO_CAPABILITIES: HomeCapabilities = {
  owner: false,
  hasOrganization: false,
  permissions: new Set(),
};

type CapabilityState =
  | { status: "loading" }
  | { status: "ok"; caps: HomeCapabilities }
  | { status: "error"; caps: HomeCapabilities };

/** Minimal slice of the Supabase session user this screen needs. */
export interface HomeUser {
  id: string;
  email?: string;
}

export function HomeView({ user }: { user: HomeUser }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useI18n();
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const userId = user.id;

  const [state, setState] = useState<CapabilityState>({ status: "loading" });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const client = supabase;
    if (!client) {
      // Not configured (e.g. missing env in a preview build): render the
      // shared, ungated cards rather than spinning forever.
      setState({ status: "ok", caps: NO_CAPABILITIES });
      return;
    }
    let active = true;
    setState({ status: "loading" });

    Promise.all([
      isPlatformOwner(client),
      getUserOrganizations(client, userId).then(async (orgs) => ({
        count: orgs.length,
        permissionLists: await Promise.all(
          orgs.map((o) => getEffectivePermissions(client, userId, o.organizationId))
        ),
      })),
    ])
      .then(([owner, orgInfo]) => {
        if (!active) return;
        setState({
          status: "ok",
          caps: {
            owner,
            hasOrganization: orgInfo.count > 0,
            permissions: new Set(orgInfo.permissionLists.flat()),
          },
        });
      })
      .catch((err: unknown) => {
        captureException(err, { screen: "home", action: "resolveCapabilities" });
        // Fail closed: gated cards stay hidden, shared cards still render.
        if (active) setState({ status: "error", caps: NO_CAPABILITIES });
      });

    return () => {
      active = false;
    };
  }, [userId]);

  // Floating "coming soon" hint for the placeholder interactions.
  const toast = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nudge = useCallback(() => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    Animated.spring(toast, { toValue: 1, useNativeDriver: true, speed: 30 }).start();
    toastTimer.current = setTimeout(() => {
      Animated.timing(toast, { toValue: 0, duration: 220, useNativeDriver: true }).start();
    }, 1400);
  }, [toast]);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    []
  );

  // Sign-out lives on the avatar (same flow the old dashboard's logout used:
  // @platform/auth signOut, then back to the logged-out entry point).
  async function handleSignOut() {
    const client = supabase;
    if (!client || signingOut) return;
    setSigningOut(true);
    try {
      await signOut(client);
      router.replace("/landing");
    } finally {
      setSigningOut(false);
    }
  }

  const confirmSignOut = () => {
    Alert.alert(t("home", "signOutConfirm"), undefined, [
      { text: t("common", "cancel"), style: "cancel" },
      { text: t("dashboard", "logout"), style: "destructive", onPress: () => void handleSignOut() },
    ]);
  };

  const caps = state.status === "loading" ? NO_CAPABILITIES : state.caps;
  const cards = state.status === "loading" ? [] : filterHomeCards(HOME_CARDS, state.caps);

  return (
    <View style={[s.container, { paddingTop: insets.top + space.sm }]}>
      <TopBar
        email={user.email}
        onMenu={() => setDrawerOpen(true)}
        onAvatar={confirmSignOut}
        signingOut={signingOut}
      />

      <ScrollView style={s.flex} contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <DateStrip />

        <View style={s.cardsWrap}>
          {state.status === "loading" ? (
            <>
              <View style={s.skeletonCard} />
              <View style={[s.skeletonCard, s.skeletonCardDim]} />
            </>
          ) : (
            <>
              {state.status === "error" ? (
                <Text style={s.loadError}>{t("common", "loadError")}</Text>
              ) : null}
              {cards.map((card) => (
                <ComingSoonCard key={card.id} card={card} onNudge={nudge} />
              ))}
            </>
          )}
        </View>
      </ScrollView>

      <Animated.View
        pointerEvents="none"
        style={[
          s.toast,
          {
            bottom: insets.bottom + space.xxl + space.xl,
            opacity: toast,
            transform: [
              { translateY: toast.interpolate({ inputRange: [0, 1], outputRange: [space.sm, 0] }) },
            ],
          },
        ]}
      >
        <Text style={s.toastText}>{t("common", "comingSoon")}</Text>
      </Animated.View>

      <View style={{ paddingBottom: insets.bottom + space.sm }}>
        <TabBar onNudge={nudge} />
      </View>

      <HomeDrawer visible={drawerOpen} onClose={() => setDrawerOpen(false)} caps={caps} />
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    flex: { flex: 1 },
    scroll: { paddingBottom: space.lg, gap: space.md },
    cardsWrap: { paddingHorizontal: space.lg, gap: space.md, paddingTop: space.xs },
    skeletonCard: {
      height: space.xxl * 2 + space.lg,
      borderRadius: radius.xl,
      backgroundColor: c.muted,
    },
    skeletonCardDim: { opacity: 0.55 },
    loadError: { color: c.mutedForeground, fontSize: text.sm, textAlign: "center" },
    toast: {
      position: "absolute",
      alignSelf: "center",
      backgroundColor: c.foreground,
      borderRadius: radius.full,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      shadowColor: c.foreground,
      shadowOpacity: 0.2,
      shadowRadius: radius.lg,
      shadowOffset: { width: 0, height: space.xs / 2 },
      elevation: 6,
    },
    toastText: { color: c.background, fontSize: text.sm, fontWeight: "600" },
  });
}
