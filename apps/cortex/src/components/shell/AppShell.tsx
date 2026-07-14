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
import { useState } from "react";
import type { ReactNode } from "react";
import { appRoute, useRegisteredApps } from "@/cortex/apps";
import { useInstalledApps } from "@/lib/installed-apps";
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
    <div className="mx-auto flex h-dvh w-full max-w-[480px] flex-col bg-screen">
      {/* Single scroll area: Header + chips row + page content scroll together. */}
      <div className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
        <Header onOpenInbox={() => setInboxOpen(true)} />

        <div className="px-4">
          <AppTabsRow tools={tabs} />
        </div>

        <main className="flex flex-1 flex-col gap-5 px-4 pb-6 pt-3">{children}</main>
      </div>

      <TabBar onOpenAi={() => setAiOpen(true)} />

      <AiSheet open={aiOpen} onClose={() => setAiOpen(false)} />
      <UrgencyInbox open={inboxOpen} onClose={() => setInboxOpen(false)} />
    </div>
  );
}
