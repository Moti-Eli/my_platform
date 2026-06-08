"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ThemeName } from "@platform/config";

/**
 * Toggles between the "default" and "dark" themes. On click it updates the
 * <html data-theme> attribute for instant feedback and persists the choice in a
 * cookie so the server renders the same theme on the next request (no flash).
 */
export function ThemeToggle({ initialTheme }: { initialTheme: ThemeName }) {
  const t = useTranslations("theme");
  const [theme, setTheme] = useState<ThemeName>(initialTheme);

  function toggle() {
    const next: ThemeName = theme === "dark" ? "default" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    document.cookie = `theme=${next};path=/;max-age=31536000;samesite=lax`;
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
    >
      {theme === "dark" ? t("toLight") : t("toDark")}
    </button>
  );
}
