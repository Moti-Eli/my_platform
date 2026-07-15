"use client";

/**
 * "כל הכלים" (catalog) — the full registry of apps in a compact icon+name grid.
 * Reads ALL registered apps (source of truth), no hardcoded list. Available apps
 * can be installed/uninstalled by tapping (install → it appears immediately in
 * the chips row and on Home); apps marked `unavailable` are shown disabled and
 * are not tappable.
 */
import type { AppManifest } from "@platform/cortex-core";
import { useRegisteredApps } from "@/cortex/apps";
import { install, uninstall, useInstalledApps } from "@/lib/installed-apps";
import { appIcon, appColorClasses } from "@/components/app-visuals";
import { CheckIcon, PlusIcon } from "@/components/icons";
import { useI18n, type MessageKey } from "@/i18n";

function CatalogCard({ manifest, installed }: { manifest: AppManifest; installed: boolean }) {
  const { t } = useI18n();
  const Icon = appIcon(manifest.icon);
  const available = manifest.status !== "unavailable";
  const label = t(manifest.name.key as MessageKey);

  const inner = (
    <>
      <span
        className={`flex h-11 w-11 items-center justify-center rounded-full ${appColorClasses(manifest.color)}`}
      >
        <Icon width={22} height={22} />
      </span>
      <span className="text-center type-label text-ink">{label}</span>
      {available ? (
        <span
          className={`absolute end-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full ${
            installed ? "bg-success text-on-fill" : "bg-hairline text-muted"
          }`}
        >
          {installed ? <CheckIcon width={13} height={13} /> : <PlusIcon width={13} height={13} />}
        </span>
      ) : (
        <span className="absolute end-1.5 top-1.5 rounded-full bg-hairline px-xs py-2xs type-caption text-muted">
          {t("apps.unavailable")}
        </span>
      )}
    </>
  );

  const cardClass =
    "relative flex h-full flex-col items-center gap-xs rounded-xl bg-card p-md pt-lg shadow-soft transition";

  if (!available) {
    return (
      <div aria-disabled className={`${cardClass} opacity-50`}>
        {inner}
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={installed}
      aria-label={label}
      onClick={() => (installed ? uninstall(manifest.id) : install(manifest.id))}
      className={`${cardClass} touch-manipulation active:transition-none active:bg-hairline motion-safe:active:scale-95`}
    >
      {inner}
    </button>
  );
}

export default function CatalogPage() {
  const { t } = useI18n();
  const apps = useRegisteredApps();
  const installed = useInstalledApps();

  return (
    <>
      <h1 className="px-2xs type-title text-ink">{t("catalog.title")}</h1>
      <section aria-label={t("catalog.title")} className="grid grid-cols-3 gap-sm">
        {apps.map((manifest) => (
          <CatalogCard
            key={manifest.id}
            manifest={manifest}
            installed={installed.includes(manifest.id)}
          />
        ))}
      </section>
    </>
  );
}
