"use client";

/**
 * Theme picker — card-style chooser (like a color-theme picker). Each card
 * previews the theme using that theme's own token values (read from the
 * design-system, not hard-coded), and selecting applies + persists it live.
 * Adding a theme = a new entry in `themes` → a new card appears automatically.
 */
import { useTheme } from "@/theme/ThemeProvider";
import { useI18n } from "@/i18n";
import { themes, themeNames } from "@/design-system";
import type { MessageKey } from "@/i18n";
import { CheckIcon } from "@/components/icons";

export function ThemePicker() {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();

  return (
    <div className="grid grid-cols-2 gap-sm">
      {themeNames.map((name) => {
        const tokens = themes[name];
        const active = name === theme;
        return (
          <button
            key={name}
            type="button"
            onClick={() => setTheme(name)}
            aria-pressed={active}
            className={`flex flex-col gap-sm rounded-lg bg-card p-md text-start transition active:scale-[0.99] ${
              active ? "ring-2 ring-ring" : "ring-1 ring-hairline"
            }`}
          >
            {/* Mini preview built from the theme's own tokens. */}
            <span
              className="flex h-16 w-full items-end gap-xs rounded-lg p-sm"
              style={{ backgroundColor: tokens.screen }}
            >
              <span
                className="h-full flex-1 rounded-md"
                style={{ backgroundColor: tokens.card }}
              />
              <span
                className="h-6 w-6 self-center rounded-full"
                style={{ backgroundColor: tokens.accent }}
              />
            </span>
            <span className="flex items-center justify-between">
              <span className="type-label text-ink">
                {t(themes[name].labelKey as MessageKey)}
              </span>
              {active ? <CheckIcon width={18} height={18} className="text-accent" /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
