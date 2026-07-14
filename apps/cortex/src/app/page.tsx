"use client";

/**
 * Home — the "הכל" (all) glance view: a single vertical column of full-width
 * preview cards, one per app, stacked and scrolling vertically. Each card is a
 * compact preview (~a third of the viewport) showing the app's actual content
 * truncated to what fits — NOT just an icon. Real registry tools render their
 * own DashboardCard; the TEMPORARY placeholder apps render a same-size card of
 * dummy rows so the preview reads as content. Tapping a card opens its page.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { listApps, type AppManifest } from "@platform/cortex-core";
import { getRuntime } from "@/cortex/runtime";
import { TOOL_VIEWS, type ToolUI } from "@/tools";
import { PLACEHOLDER_APPS, type PlaceholderApp } from "@/lib/placeholder-apps";
import { useI18n } from "@/i18n";

interface PinnedTool {
  manifest: AppManifest;
  ui: ToolUI;
}

/**
 * A placeholder preview card — same size and visual language as a real
 * DashboardCard (title + icon + a few rows), but filled with dummy skeleton rows
 * so it reads as real content rather than an empty box.
 */
function PlaceholderPreviewCard({ app }: { app: PlaceholderApp }) {
  const { t } = useI18n();
  const { Icon } = app;

  return (
    <div className="rounded-xl bg-card p-4 shadow-soft">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo/15 text-indigo">
          <Icon width={20} height={20} />
        </span>
        <span className="text-sm font-bold text-ink">{t(app.labelKey)}</span>
      </div>

      <ul className="flex flex-col gap-1.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <li
            key={i}
            className="flex items-center justify-between rounded-lg bg-screen px-3 py-2.5"
          >
            <span className="h-3 w-1/3 rounded-full bg-hairline" />
            <span className="h-3 w-8 rounded-full bg-hairline" />
          </li>
        ))}
      </ul>
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

  return (
    <section aria-label={t("home.dashboardLabel")} className="flex flex-1 flex-col gap-4">
      {/* Real registry tools — their own DashboardCard (inventory shows real rows). */}
      {tools.map((tool) => {
        const Card = tool.ui.DashboardCard;
        return (
          <Link key={tool.manifest.id} href={tool.ui.route} className="block">
            <Card />
          </Link>
        );
      })}

      {/* Temporary placeholder apps — same-size preview cards with dummy rows. */}
      {PLACEHOLDER_APPS.map((app) => (
        <Link key={app.id} href={app.route} aria-label={t(app.labelKey)} className="block">
          <PlaceholderPreviewCard app={app} />
        </Link>
      ))}
    </section>
  );
}
