"use client";

/**
 * Home — the "הכל" (all) glance view: a compact grid of small, uniform preview
 * cards, one per app, so the whole toolbox is visible at once. It combines the
 * real registry tools (initialized via the runtime) with the TEMPORARY
 * placeholder apps. Each card links to that app's page. Card visual language
 * follows the inventory DashboardCard, scaled down and made uniform (icon + name
 * only — no stats).
 */
import { useEffect, useState } from "react";
import type { ComponentType, SVGProps } from "react";
import Link from "next/link";
import { listApps, type AppManifest } from "@platform/cortex-core";
import { getRuntime } from "@/cortex/runtime";
import { TOOL_VIEWS, type ToolUI } from "@/tools";
import { BoxIcon } from "@/components/icons";
import { PLACEHOLDER_APPS } from "@/lib/placeholder-apps";
import { useI18n, type MessageKey } from "@/i18n";

interface PinnedTool {
  manifest: AppManifest;
  ui: ToolUI;
}

type GridApp = {
  id: string;
  label: string;
  route: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
};

/** One small, uniform preview card — a scaled-down DashboardCard (icon + name). */
function MiniAppCard({ label, Icon }: { label: string; Icon: GridApp["Icon"] }) {
  return (
    <div className="flex h-full flex-col items-center gap-2 rounded-xl bg-card p-3 shadow-soft transition active:scale-95">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-indigo/15 text-indigo">
        <Icon width={22} height={22} />
      </span>
      <span className="text-center text-xs font-semibold leading-tight text-ink">{label}</span>
    </div>
  );
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

  // Real registry tools first, then the temporary placeholder apps. (Real tools
  // reuse a generic tool glyph for now; the grid stays visually uniform.)
  const apps: GridApp[] = [
    ...tools.map((tool) => ({
      id: tool.manifest.id,
      // Manifests carry i18n keys as strings by design — resolve at this boundary.
      label: t(tool.manifest.name.key as MessageKey),
      route: tool.ui.route,
      Icon: BoxIcon,
    })),
    ...PLACEHOLDER_APPS.map((app) => ({
      id: app.id,
      label: t(app.labelKey),
      route: app.route,
      Icon: app.Icon,
    })),
  ];

  return (
    <section aria-label={t("home.dashboardLabel")} className="grid grid-cols-3 gap-3">
      {apps.map((app) => (
        <Link key={app.id} href={app.route} aria-label={app.label} className="block">
          <MiniAppCard label={app.label} Icon={app.Icon} />
        </Link>
      ))}
    </section>
  );
}
