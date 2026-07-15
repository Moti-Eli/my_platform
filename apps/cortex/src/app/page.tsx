"use client";

/**
 * Home — the "הכל" (all) glance view: a vertical column of full-width preview
 * cards, one per INSTALLED app. Real tools render their own DashboardCard; stub
 * apps render a same-size placeholder card of dummy rows. Everything is read from
 * the registry (source of truth) filtered by the installed set — no hardcoded
 * lists. When nothing is installed yet, a friendly empty state points at "+".
 */
import type { AppManifest } from "@platform/cortex-core";
import Link from "next/link";
import { appRoute, useRegisteredApps } from "@/cortex/apps";
import { useInstalledApps } from "@/lib/installed-apps";
import { TOOL_VIEWS } from "@/tools";
import { appIcon, appColorClasses } from "@/components/app-visuals";
import { EmptyState } from "@/components/EmptyState";
import { PlusIcon } from "@/components/icons";
import { useI18n, type MessageKey } from "@/i18n";

/**
 * A stub's preview card — same size and visual language as a real DashboardCard
 * (title + icon + a few rows), filled with dummy skeleton rows so it reads as
 * real content rather than an empty box.
 */
function PlaceholderPreviewCard({ manifest }: { manifest: AppManifest }) {
  const { t } = useI18n();
  const Icon = appIcon(manifest.icon);

  return (
    <div className="rounded-xl bg-card p-4 shadow-soft">
      <div className="mb-3 flex items-center gap-2">
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-full ${appColorClasses(manifest.color)}`}
        >
          <Icon width={20} height={20} />
        </span>
        <span className="type-heading text-ink">{t(manifest.name.key as MessageKey)}</span>
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
  const apps = useRegisteredApps();
  const installed = useInstalledApps();

  // Render in the user's INSTALL order (not registry order): walk the installed
  // list and resolve each id against the registry.
  const byId = new Map(apps.map((manifest) => [manifest.id, manifest]));
  const installedApps = installed.flatMap((id) => {
    const manifest = byId.get(id);
    return manifest ? [manifest] : [];
  });

  if (installedApps.length === 0) {
    return (
      <section aria-label={t("home.dashboardLabel")} className="flex flex-1 flex-col">
        <EmptyState
          icon={<PlusIcon />}
          title={t("home.emptyInstalledTitle")}
          hint={t("home.emptyInstalledHint")}
        />
      </section>
    );
  }

  return (
    <section aria-label={t("home.dashboardLabel")} className="flex flex-1 flex-col gap-4">
      {installedApps.map((manifest) => {
        const view = !manifest.stub ? TOOL_VIEWS[manifest.id] : undefined;
        const Card = view?.DashboardCard;
        return (
          <Link
            key={manifest.id}
            href={appRoute(manifest.id)}
            className="block touch-manipulation transition active:transition-none active:opacity-90 motion-safe:active:scale-[0.98]"
          >
            {Card ? <Card /> : <PlaceholderPreviewCard manifest={manifest} />}
          </Link>
        );
      })}
    </section>
  );
}
