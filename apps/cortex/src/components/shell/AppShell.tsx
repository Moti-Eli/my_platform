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
import { Header } from "./Header";
import { TabBar } from "./TabBar";
import { AiSheet } from "./AiSheet";
import { UrgencyInbox } from "./UrgencyInbox";

export function AppShell({ children }: { children: ReactNode }) {
  const [aiOpen, setAiOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);

  return (
    <div className="mx-auto flex h-dvh w-full max-w-[480px] flex-col bg-screen">
      {/* Single scroll area: Header + page content scroll together. */}
      <div className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
        <Header onOpenInbox={() => setInboxOpen(true)} />

        <main className="flex flex-1 flex-col gap-5 px-4 pb-6 pt-2">{children}</main>
      </div>

      <TabBar onOpenAi={() => setAiOpen(true)} />

      <AiSheet open={aiOpen} onClose={() => setAiOpen(false)} />
      <UrgencyInbox open={inboxOpen} onClose={() => setInboxOpen(false)} />
    </div>
  );
}
