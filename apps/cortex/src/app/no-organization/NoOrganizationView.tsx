"use client";

import { useI18n } from "@/i18n";

/** Client body: translated text only. See page.tsx for why this state exists. */
export function NoOrganizationView() {
  const { t } = useI18n();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-sm px-lg py-xl text-center">
      <h1 className="text-lg font-semibold text-ink">{t("session.noOrgTitle")}</h1>
      <p className="text-sm text-muted">{t("session.noOrgHint")}</p>
    </main>
  );
}
