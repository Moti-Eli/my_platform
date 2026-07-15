"use client";

/**
 * Version — the drill-in page for the /settings "גרסה" row. Standard fixed top
 * bar (back on the left) + title, with the current version number and a short
 * description of what Cortex is as the body.
 */
import { Screen } from "@/components/profile/Screen";
import { APP_VERSION } from "@/lib/version";
import { useI18n } from "@/i18n";

export default function VersionSettingsPage() {
  const { t } = useI18n();
  return (
    <Screen center={<h1 className="text-lg font-bold text-ink">{t("settings.version")}</h1>}>
      <div className="mt-6 space-y-3">
        <p className="text-3xl font-bold text-ink" dir="ltr">
          {APP_VERSION}
        </p>
        <p className="text-sm leading-relaxed text-muted">{t("settings.versionAbout")}</p>
      </div>
    </Screen>
  );
}
