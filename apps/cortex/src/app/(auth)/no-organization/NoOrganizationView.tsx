"use client";

import { useI18n } from "@/i18n";

/**
 * Client body: translated text only. See page.tsx for why this state exists.
 *
 * No `<main>` and no centring of its own — the `(auth)` layout owns both. It
 * previously rendered its own `<main>` nested inside AppShell's, which was both
 * invalid HTML and wrapped a "you have no organization" message in a shell full
 * of tools the user cannot reach.
 *
 * Type roles only: `text-lg` / `text-sm` do not resolve (`--text-*: initial`).
 */
export function NoOrganizationView() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-xs text-center">
      <h1 className="type-title text-ink">{t("session.noOrgTitle")}</h1>
      <p className="type-body text-muted">{t("session.noOrgHint")}</p>
    </div>
  );
}
