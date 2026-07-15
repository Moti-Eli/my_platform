"use client";

/**
 * Language settings — the drill-in page for the /settings "שפה" row. Standard
 * fixed top bar (back on the left) + title, with the existing LanguagePicker as
 * the body (moved here verbatim — its wiring/behavior is unchanged).
 */
import { Screen } from "@/components/profile/Screen";
import { LanguagePicker } from "@/components/settings/LanguagePicker";
import { useI18n } from "@/i18n";

export default function LanguageSettingsPage() {
  const { t } = useI18n();
  return (
    <Screen center={<h1 className="type-title text-ink">{t("settings.language")}</h1>}>
      <div className="mt-xs">
        <LanguagePicker />
      </div>
    </Screen>
  );
}
