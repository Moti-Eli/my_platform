"use client";

/**
 * Appearance settings — the drill-in page for the /settings "נראות" row. Standard
 * fixed top bar (back on the left) + title, with the existing ThemePicker as the
 * body (moved here verbatim — its wiring/behavior is unchanged).
 */
import { Screen } from "@/components/profile/Screen";
import { ThemePicker } from "@/components/settings/ThemePicker";
import { useI18n } from "@/i18n";

export default function AppearanceSettingsPage() {
  const { t } = useI18n();
  return (
    <Screen center={<h1 className="type-title text-ink">{t("settings.appearance")}</h1>}>
      <div className="mt-2">
        <ThemePicker />
      </div>
    </Screen>
  );
}
