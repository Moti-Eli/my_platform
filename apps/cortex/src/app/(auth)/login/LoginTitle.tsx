"use client";

import { useI18n } from "@/i18n";

/**
 * The login heading. A client component only because `useI18n` is a context —
 * Cortex resolves its locale from a cookie in the root layout and shares it via
 * that provider, so any translated string needs the client.
 *
 * TYPE ROLES ONLY. The design-system clears Tailwind's font-size namespace
 * (`--text-*: initial` in globals.css) — type is a closed set of `.type-*` roles,
 * exactly like colour — so `text-xl` / `text-sm` resolve to NOTHING and silently
 * fall back to inherited sizes. Each role also bundles its own weight, so pairing
 * one with `font-semibold` is size and weight drifting apart, which the roles
 * exist to prevent.
 */
export function LoginTitle() {
  const { t } = useI18n();
  return (
    <header className="flex flex-col gap-2xs text-center">
      <h1 className="type-title text-ink">{t("login.title")}</h1>
      <p className="type-body text-muted">{t("login.subtitle")}</p>
    </header>
  );
}
