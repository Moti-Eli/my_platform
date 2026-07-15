"use client";

/**
 * Settings — three flat rows sitting directly on the screen background (no card,
 * no dividers). Each row drills in to a dedicated page: language and appearance
 * host the existing pickers unchanged; version shows the number + a short
 * description of the app.
 */
import { useI18n } from "@/i18n";
import { useTheme } from "@/theme/ThemeProvider";
import { APP_VERSION } from "@/lib/version";
import { Screen } from "@/components/profile/Screen";
import { ListRow } from "@/components/profile/SettingsList";
import { GlobeIcon, ContrastIcon, InfoIcon } from "@/components/icons";

export default function SettingsPage() {
  const { t, locale } = useI18n();
  const { theme } = useTheme();

  const languageValue = t(locale === "he" ? "settings.languageHe" : "settings.languageEn");
  const themeValue = t(theme === "light" ? "settings.themeLight" : "settings.themeDark");

  return (
    <Screen center={<h1 className="type-title text-ink">{t("settings.title")}</h1>}>
      <div className="mt-2">
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

      <p className="px-1 pt-4 text-center type-caption text-muted">{t("common.savedLocally")}</p>
    </Screen>
  );
}
