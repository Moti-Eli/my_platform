"use client";

/**
 * The Cortex shell frame. Wraps every screen: a phone-first column (centered on
 * desktop, exactly one visible-viewport tall) whose Header, chips row and page
 * content share a SINGLE vertical scroll area, beneath a TabBar pinned to the
 * bottom (never scrolls). The Header is intentionally not sticky — it scrolls
 * away with the content so later sub-app rows don't stack up as fixed bars.
 * Also hosts the AI sheet and urgency inbox overlays, whose open state lives
 * here so they persist across route changes.
 *
 * Height tracks the ACTUAL visible viewport via {@link useVisibleViewportHeight}
 * (the `--app-vh` variable), not just `100dvh` — see that hook for why Android
 * Chrome's collapsing URL bar makes `dvh` insufficient on its own.
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { appRoute, useRegisteredApps } from "@/cortex/apps";
import { useInstalledApps } from "@/lib/installed-apps";
import { useI18n, type MessageKey } from "@/i18n";
import { Header } from "./Header";
import { TabBar } from "./TabBar";
import { AppTabsRow, type ToolTab } from "./AppTabsRow";
import { AiSheet } from "./AiSheet";
import { UrgencyInbox } from "./UrgencyInbox";

/**
 * Drive the `--app-vh` CSS variable from the VisualViewport API — the height of
 * the CURRENTLY visible viewport. On Android Chrome this tracks the collapsing/
 * expanding URL bar in real time and, unlike `100dvh`, does not lag or briefly
 * report the URL-bar-hidden height during the transition (which is what let the
 * bottom-pinned TabBar slip behind the browser/system chrome). Updates on both
 * VisualViewport `resize` and `scroll` (the bar collapses mid-scroll), throttled
 * to a frame. When the API is unavailable (older browsers, SSR) nothing is set
 * and the shell's `var(--app-vh, 100dvh)` height resolves to `100dvh` — so the
 * desktop and iOS fallback path behaves exactly as it does today.
 */
function useVisibleViewportHeight(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    let frame = 0;
    const measure = () => {
      frame = 0;
      document.documentElement.style.setProperty("--app-vh", `${vv.height}px`);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    measure(); // Correct the height immediately, before any scroll.
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      document.documentElement.style.removeProperty("--app-vh");
    };
  }, []);
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [aiOpen, setAiOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);

  // Keep the shell height locked to the real visible viewport (Android URL bar).
  useVisibleViewportHeight();

  // Full-bleed routes replace the shell chrome (wordmark/search/bell header + app
  // chips row) with their OWN fixed top bar — the profile and settings screens.
  // Same single shell, conditional chrome; the bottom TabBar always stays.
  const pathname = usePathname();
  const fullBleed = pathname.startsWith("/profile") || pathname.startsWith("/settings");

  // Overlays are dismissed on navigation so a new screen never opens under them.
  useEffect(() => {
    setAiOpen(false);
    setInboxOpen(false);
  }, [pathname]);

  // Chips show ONLY installed apps, in the user's INSTALL order (not registry
  // order): iterate the installed list and resolve each id against the registry.
  // Labels are translated at render so they follow locale.
  const apps = useRegisteredApps();
  const installed = useInstalledApps();
  const byId = new Map(apps.map((manifest) => [manifest.id, manifest]));
  const tabs: ToolTab[] = installed.flatMap((id) => {
    const manifest = byId.get(id);
    if (!manifest) return [];
    return [{ id, label: t(manifest.name.key as MessageKey), route: appRoute(id) }];
  });

  return (
    <div
      className="mx-auto flex w-full max-w-[480px] flex-col bg-screen"
      // Real visible-viewport height (see useVisibleViewportHeight); resolves to
      // 100dvh until/if the VisualViewport API sets --app-vh.
      style={{ height: "var(--app-vh, 100dvh)" }}
    >
      {/* Content + overlays share this box, which stops at the TabBar's top edge —
          so the AI sheet (absolute, bottom-0) rises to exactly there and the tab
          bar (a sibling below, higher z) is never covered and stays tappable. */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {fullBleed ? (
          // The screen owns its own fixed top bar + scrolling body (see @/components/profile/Screen).
          <main className="flex min-h-0 flex-1 flex-col">{children}</main>
        ) : (
          // Single scroll area: Header + chips row + page content scroll together.
          <div className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
            <Header onOpenInbox={() => setInboxOpen(true)} />

            <div className="px-4">
              <AppTabsRow tools={tabs} />
            </div>

            <main className="flex flex-1 flex-col gap-5 px-4 pb-6 pt-3">{children}</main>
          </div>
        )}

        <AiSheet open={aiOpen} onClose={() => setAiOpen(false)} />
        <UrgencyInbox open={inboxOpen} onClose={() => setInboxOpen(false)} />
      </div>

      <TabBar aiOpen={aiOpen} onToggleAi={() => setAiOpen((v) => !v)} />
    </div>
  );
}
