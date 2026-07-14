"use client";

/**
 * Settings — language (i18n), appearance (themes), and the app version.
 * Reachable from the header gear and the Profile screen. Built from
 * @/design-system + i18n only (no hard-coded colors or strings). The version is
 * read from the single source of truth (package.json via @/lib/version).
 */
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n";
import { APP_VERSION } from "@/lib/version";
import { ChevronIcon } from "@/components/icons";
import { LanguagePicker } from "@/components/settings/LanguagePicker";
import { ThemePicker } from "@/components/settings/ThemePicker";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="px-1 text-sm font-semibold text-muted">{title}</h2>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  const { t, dir } = useI18n();
  const router = useRouter();

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label={t("common.back")}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-ink shadow-soft transition active:scale-95"
        >
          <ChevronIcon style={{ transform: dir === "rtl" ? "scaleX(-1)" : undefined }} />
        </button>
        <h1 className="text-xl font-bold text-ink">{t("settings.title")}</h1>
      </div>

      <Section title={t("settings.language")}>
        <LanguagePicker />
      </Section>

      <Section title={t("settings.appearance")}>
        <ThemePicker />
      </Section>

      <Section title={t("settings.version")}>
        <div className="flex items-center justify-between rounded-xl bg-card px-4 py-4 shadow-soft">
          <span className="text-sm font-semibold text-ink">{t("settings.version")}</span>
          <span className="text-sm text-muted" dir="ltr">
            {APP_VERSION}
          </span>
        </div>
      </Section>

      <p className="px-1 pt-1 text-center text-xs text-muted">{t("common.savedLocally")}</p>
    </>
  );
}
