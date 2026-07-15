"use client";

/**
 * Settings — three flat rows sitting directly on the screen background (no card,
 * no dividers). Each row drills in to a dedicated page: language and appearance
 * host the existing pickers unchanged; version shows the number + a short
 * description of the app.
 */
import { useI18n, type MessageKey } from "@/i18n";
import { useTheme } from "@/theme/ThemeProvider";
import { themes } from "@/design-system";
import { APP_VERSION } from "@/lib/version";
import { Screen } from "@/components/profile/Screen";
import { ListRow } from "@/components/profile/SettingsList";
import { GlobeIcon, ContrastIcon, InfoIcon } from "@/components/icons";

export default function SettingsPage() {
  const { t, locale } = useI18n();
  const { theme } = useTheme();

  const languageValue = t(locale === "he" ? "settings.languageHe" : "settings.languageEn");
  // Read the active theme's own label from the registry — single source of truth,
  // so this works for all six themes (no parallel light/dark mapping here).
  const themeValue = t(themes[theme].labelKey as MessageKey);

  return (
    <Screen center={<h1 className="type-title text-ink">{t("settings.title")}</h1>}>
      <div className="mt-xs">
        <ListRow
          href="/settings/language"
          icon={<GlobeIcon />}
          label={t("settings.language")}
          value={languageValue}
        />
        <ListRow
          href="/settings/appearance"
          icon={<ContrastIcon />}
          label={t("settings.appearance")}
          value={themeValue}
        />
        <ListRow
          href="/settings/version"
          icon={<InfoIcon />}
          label={t("settings.version")}
          value={APP_VERSION}
        />
      </div>

      <p className="px-2xs pt-md text-center type-caption text-muted">{t("common.savedLocally")}</p>
    </Screen>
  );
}
