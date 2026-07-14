"use client";

/**
 * The Cortex shell frame. Wraps every screen: a phone-first column (centered on
 * desktop, exactly one viewport tall) whose Header, chips row and page content
 * share a SINGLE vertical scroll area, beneath a TabBar that is fixed at the
 * bottom (never scrolls). The Header is intentionally not sticky — it scrolls
 * away with the content so later sub-app rows don't stack up as fixed bars.
 * Also hosts the AI sheet and urgency inbox overlays, whose open state lives
 * here so they persist across route changes.
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { listApps, type AppManifest } from "@platform/cortex-core";
import { getRuntime } from "@/cortex/runtime";
import { TOOL_VIEWS } from "@/tools";
import { useI18n, type MessageKey } from "@/i18n";
import { Header } from "./Header";
import { TabBar } from "./TabBar";
import { AppTabsRow, type ToolTab } from "./AppTabsRow";
import { AiSheet } from "./AiSheet";
import { UrgencyInbox } from "./UrgencyInbox";

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [aiOpen, setAiOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);

  // Feed the app-chips row from the core registry (moved up from the Home page
  // so the row shows on every screen). Store raw manifests; translate labels at
  // render so they follow locale changes.
  const [manifests, setManifests] = useState<AppManifest[]>([]);
  useEffect(() => {
    let alive = true;
    getRuntime().then(() => {
      if (!alive) return;
      setManifests(
        listApps()
          .map((app) => app.manifest)
          .filter((manifest) => TOOL_VIEWS[manifest.id]),
      );
    });
    return () => {
      alive = false;
    };
  }, []);

  const tabs: ToolTab[] = manifests.map((manifest) => ({
    id: manifest.id,
    label: t(manifest.name.key as MessageKey),
    route: TOOL_VIEWS[manifest.id]!.route,
  }));

  return (
    <div className="mx-auto flex h-dvh w-full max-w-[480px] flex-col bg-screen">
      {/* Single scroll area: Header + chips row + page content scroll together. */}
      <div className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
        <Header onOpenInbox={() => setInboxOpen(true)} />

        <div className="px-4">
          <AppTabsRow tools={tabs} />
        </div>

        {/* Full-bleed hairline separating the chips row from the screen content.
            Lives inside the scroll area, so it scrolls off with the header/chips. */}
        <div className="h-px w-full bg-hairline" />

        <main className="flex flex-1 flex-col gap-5 px-4 pb-6 pt-3">{children}</main>
      </div>

      <TabBar onOpenAi={() => setAiOpen(true)} />

      <AiSheet open={aiOpen} onClose={() => setAiOpen(false)} />
      <UrgencyInbox open={inboxOpen} onClose={() => setInboxOpen(false)} />
    </div>
  );
}
