"use client";

/**
 * Home — shows the pinned tools. Ensures the runtime is initialized (which
 * registers the tools), then renders one tab + one dashboard card per registered
 * tool that has a UI (from the TOOL_VIEWS registry). Falls back to the empty
 * state when nothing is pinned.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { listApps, type AppManifest } from "@platform/cortex-core";
import { getRuntime } from "@/cortex/runtime";
import { TOOL_VIEWS, type ToolUI } from "@/tools";
import { AppTabsRow, type ToolTab } from "@/components/home/AppTabsRow";
import { EmptyState } from "@/components/EmptyState";
import { PinIcon } from "@/components/icons";
import { useI18n, type MessageKey } from "@/i18n";

interface PinnedTool {
  manifest: AppManifest;
  ui: ToolUI;
}

export default function HomePage() {
  const { t } = useI18n();
  const [tools, setTools] = useState<PinnedTool[]>([]);

  useEffect(() => {
    let alive = true;
    getRuntime().then(() => {
      if (!alive) return;
      setTools(
        listApps()
          .map((app) => app.manifest)
          .filter((manifest) => TOOL_VIEWS[manifest.id])
          .map((manifest) => ({ manifest, ui: TOOL_VIEWS[manifest.id]! })),
      );
    });
    return () => {
      alive = false;
    };
  }, []);

  const tabs: ToolTab[] = tools.map((tool) => ({
    id: tool.manifest.id,
    // Manifests carry i18n keys as strings by design — resolve at this boundary.
    label: t(tool.manifest.name.key as MessageKey),
    route: tool.ui.route,
  }));

  return (
    <>
      <AppTabsRow tools={tabs} />

      <section aria-label={t("home.dashboardLabel")} className="flex flex-1 flex-col gap-4">
        {tools.length === 0 ? (
          <EmptyState icon={<PinIcon />} title={t("home.emptyTitle")} hint={t("home.emptyHint")} />
        ) : (
          tools.map((tool) => {
            const Card = tool.ui.DashboardCard;
            return (
              <Link key={tool.manifest.id} href={tool.ui.route} className="block">
                <Card />
              </Link>
            );
          })
        )}
      </section>
    </>
  );
}
