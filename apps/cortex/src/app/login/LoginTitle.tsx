"use client";

import { useI18n } from "@/i18n";

/**
 * The login heading. A client component only because `useI18n` is a context —
 * Cortex resolves its locale from a cookie in the root layout and shares it via
 * that provider, so any translated string needs the client.
 */
export function LoginTitle() {
  const { t } = useI18n();
  return (
    <header className="flex flex-col gap-xs text-center">
      <h1 className="text-xl font-semibold text-ink">{t("login.title")}</h1>
      <p className="text-sm text-muted">{t("login.subtitle")}</p>
    </header>
  );
}
