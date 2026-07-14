"use client";

/**
 * Settings — a row list (same pattern as the profile). Language and appearance
 * are ListRows showing their current value and drilling in to a dedicated page
 * (/settings/language, /settings/appearance) that hosts the existing picker;
 * version is a static ListValueRow (no drill-in). The pickers themselves are
 * unchanged — this screen only routes to them. The version is read from the
 * single source of truth (package.json via @/lib/version).
 */
import { useI18n } from "@/i18n";
import { useTheme } from "@/theme/ThemeProvider";
import { APP_VERSION } from "@/lib/version";
import { Screen } from "@/components/profile/Screen";
import { ListRow, ListValueRow } from "@/components/profile/SettingsList";
import { GlobeIcon, ContrastIcon } from "@/components/icons";

export default function SettingsPage() {
  const { t, locale } = useI18n();
  const { theme } = useTheme();

  const languageValue = t(locale === "he" ? "settings.languageHe" : "settings.languageEn");
  const themeValue = t(theme === "light" ? "settings.themeLight" : "settings.themeDark");

  return (
    <Screen center={<h1 className="text-lg font-bold text-ink">{t("settings.title")}</h1>}>
      <div className="mt-2 divide-y divide-hairline overflow-hidden rounded-xl bg-card shadow-soft">
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
        <ListValueRow label={t("settings.version")} value={APP_VERSION} />
      </div>

      <p className="px-1 pt-4 text-center text-xs text-muted">{t("common.savedLocally")}</p>
    </Screen>
  );
}
