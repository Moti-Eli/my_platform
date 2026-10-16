"use client";

/**
 * A stub sub-app's screen — resolved from the registry by id (no hardcoded
 * list). Shows the app's title (icon + name) + a "coming soon" note + dummy
 * filler cards, enough to overflow the viewport so the header + chips row can be
 * seen scrolling up while the tab bar stays fixed. No real logic or data. When a
 * real tool replaces the stub, it ships its own screen and this is unused.
 */
import { useRegisteredApps } from "@/cortex/apps";
import { appIcon, appColorClasses } from "@/components/app-visuals";
import { useI18n, type MessageKey } from "@/i18n";

export function PlaceholderScreen({ appId }: { appId: string }) {
  const { t } = useI18n();
  const apps = useRegisteredApps();
  const manifest = apps.find((a) => a.id === appId);
  const Icon = manifest ? appIcon(manifest.icon) : null;

  return (
    <>
      <div className="flex items-center gap-sm">
        {manifest && Icon ? (
          <span
            className={`flex h-11 w-11 items-center justify-center rounded-full ${appColorClasses(manifest.color)}`}
          >
            <Icon width={22} height={22} />
          </span>
        ) : null}
        <div className="flex flex-col">
          <h1 className="type-title text-ink">
            {manifest ? t(manifest.name.key as MessageKey) : ""}
          </h1>
          <p className="type-label text-muted">{t("apps.comingSoon")}</p>
        </div>
      </div>

      {/* Dummy filler — repeated skeleton cards to overflow the viewport. */}
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="rounded-lg bg-card p-md">
          <div className="mb-xs h-4 w-1/2 rounded-full bg-screen" />
          <div className="mb-xs h-3 w-full rounded-full bg-screen" />
          <div className="h-3 w-3/4 rounded-full bg-screen" />
        </div>
      ))}
    </>
  );
}
