"use client";

/**
 * "כל הכלים" (catalog) — the full registry of apps in a compact icon+name grid.
 * Reads ALL registered apps (source of truth), no hardcoded list.
 *
 * Each available app is TWO independent targets, never one:
 *   - the CARD BODY  → installs if needed, then opens the tool;
 *   - the CORNER BADGE → toggles presence in the chips row / Home ONLY, and
 *     never navigates.
 * An app is never removed from the catalog itself — the badge only controls
 * whether it shows up in the tools bar. Apps marked `unavailable` stay inert.
 */
import type { AppManifest } from "@platform/cortex-core";
import { useRouter } from "next/navigation";
import { useRegisteredApps, appRoute } from "@/cortex/apps";
import { install, uninstall, useInstalledApps } from "@/lib/installed-apps";
import { appIcon, appColorClasses } from "@/components/app-visuals";
import { CheckIcon, PlusIcon } from "@/components/icons";
import { useI18n, type MessageKey } from "@/i18n";

function CatalogCard({
  manifest,
  installed,
  locked,
}: {
  manifest: AppManifest;
  installed: boolean;
  locked: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const Icon = appIcon(manifest.icon);
  const available = manifest.status !== "unavailable";
  const label = t(manifest.name.key as MessageKey);

  const cardContent = (
    <>
      <span
        className={`flex h-11 w-11 items-center justify-center rounded-full ${appColorClasses(manifest.color)}`}
      >
        <Icon width={22} height={22} />
      </span>
      <span className="text-center type-label text-ink">{label}</span>
    </>
  );

  // w-full is load-bearing now: the card used to be the grid item (grid items
  // stretch); inside the wrapper below a <button> would shrink to its content.
  const cardClass =
    "relative flex h-full w-full flex-col items-center gap-xs rounded-lg bg-card p-md pt-lg";

  if (!available) {
    return (
      <div aria-disabled className={`${cardClass} opacity-50`}>
        {cardContent}
        <span className="absolute end-1.5 top-1.5 rounded-full bg-hairline px-xs py-2xs type-caption text-muted">
          {t("apps.unavailable")}
        </span>
      </div>
    );
  }

  // requiresAdmin, and the caller is not an admin: mirror the unavailable branch
  // EXACTLY — dimmed, aria-disabled, not a button (no navigation), and NO install
  // toggle (a non-admin can't use it, so don't let them add it to the bar). Only
  // the badge text differs.
  if (locked) {
    return (
      <div aria-disabled className={`${cardClass} opacity-50`}>
        {cardContent}
        <span className="absolute end-1.5 top-1.5 rounded-full bg-hairline px-xs py-2xs type-caption text-muted">
          {t("apps.adminOnly")}
        </span>
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <button
        type="button"
        aria-label={label}
        onClick={() => {
          if (!installed) install(manifest.id);
          router.push(appRoute(manifest.id));
        }}
        className={`${cardClass} touch-manipulation interactive`}
      >
        {cardContent}
      </button>

      {/* SIBLING of the card button (a <button> cannot nest a <button>), layered
          over its corner — so a badge tap never reaches the card. The wrapper
          carries the positioning because `.interactive` sets `position: relative`
          from an UNLAYERED rule, which would beat Tailwind's layered `absolute`
          utility and drop the badge back into normal flow. `-m-2` then grows the
          tap target to 36px WITHOUT moving the 20px dot. */}
      <span className="absolute end-1.5 top-1.5 z-10">
        <button
          type="button"
          aria-pressed={installed}
          aria-label={installed ? t("catalog.removeFromBar") : t("catalog.addToBar")}
          onClick={() => (installed ? uninstall(manifest.id) : install(manifest.id))}
          className="-m-2 flex h-9 w-9 items-center justify-center rounded-full touch-manipulation interactive"
        >
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full ${
              installed ? "bg-success text-on-fill" : "bg-hairline text-muted"
            }`}
          >
            {installed ? <CheckIcon width={13} height={13} /> : <PlusIcon width={13} height={13} />}
          </span>
        </button>
      </span>
    </div>
  );
}

export function CatalogView({ isAdmin }: { isAdmin: boolean }) {
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
            locked={Boolean(manifest.requiresAdmin) && !isAdmin}
          />
        ))}
      </section>
    </>
  );
}
