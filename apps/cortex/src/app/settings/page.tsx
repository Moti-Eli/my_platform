"use client";

/**
 * Settings — language (i18n), appearance (themes), and the app version. Reachable
 * from the profile menu (hamburger) and rows. Presented in the same full-bleed
 * language as the profile (fixed top bar + grouped sections); the LanguagePicker /
 * ThemePicker wiring is unchanged — only the surrounding presentation. The version
 * is read from the single source of truth (package.json via @/lib/version).
 */
import type { ReactNode } from "react";
import { useI18n } from "@/i18n";
import { APP_VERSION } from "@/lib/version";
import { Screen } from "@/components/profile/Screen";
import { ListValueRow } from "@/components/profile/SettingsList";
import { LanguagePicker } from "@/components/settings/LanguagePicker";
import { ThemePicker } from "@/components/settings/ThemePicker";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 first:mt-4">
      <h2 className="px-1 pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  const { t } = useI18n();

  return (
    <Screen center={<h1 className="text-lg font-bold text-ink">{t("settings.title")}</h1>}>
      <Section title={t("settings.language")}>
        <LanguagePicker />
      </Section>

      <Section title={t("settings.appearance")}>
        <ThemePicker />
      </Section>

      <Section title={t("settings.version")}>
        <div className="divide-y divide-hairline overflow-hidden rounded-xl bg-card shadow-soft">
          <ListValueRow label={t("settings.version")} value={APP_VERSION} />
        </div>
      </Section>

      <p className="px-1 pt-4 text-center text-xs text-muted">{t("common.savedLocally")}</p>
    </Screen>
  );
}
