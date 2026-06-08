/**
 * Theme definitions.
 *
 * Themes are expressed as *semantic* tokens (background, foreground, primary,
 * ...) whose values are drawn from the shared color scale in `design-tokens`.
 * Nothing here is a hard-coded color — every value references the token scale —
 * so the two themes stay coherent, and switching is just a matter of which
 * scale values map to each semantic slot.
 *
 * Apps render `themeStylesheet()` once (server-side) to emit CSS variables for
 * every theme; switching is then just toggling `data-theme` on the <html>
 * element (SSR-safe, no flash, no hydration mismatch).
 */
import { colors, fonts, radii } from "./design-tokens";

export type ThemeName = "default" | "dark";

export const themeNames: readonly ThemeName[] = ["default", "dark"];
export const defaultTheme: ThemeName = "default";

interface SemanticTokens {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  primary: string;
  primaryForeground: string;
  muted: string;
  mutedForeground: string;
  border: string;
}

export const themes: Record<ThemeName, SemanticTokens> = {
  default: {
    background: colors.neutral[50],
    foreground: colors.neutral[900],
    card: colors.neutral[0],
    cardForeground: colors.neutral[900],
    primary: colors.primary[500],
    primaryForeground: colors.neutral[0],
    muted: colors.neutral[100],
    mutedForeground: colors.neutral[500],
    border: colors.neutral[200],
  },
  dark: {
    background: colors.neutral[900],
    foreground: colors.neutral[50],
    card: colors.neutral[800],
    cardForeground: colors.neutral[50],
    primary: colors.primary[500],
    primaryForeground: colors.neutral[0],
    muted: colors.neutral[800],
    mutedForeground: colors.neutral[500],
    border: colors.neutral[700],
  },
};

function toCssVars(tokens: SemanticTokens): string {
  return [
    `--background:${tokens.background}`,
    `--foreground:${tokens.foreground}`,
    `--card:${tokens.card}`,
    `--card-foreground:${tokens.cardForeground}`,
    `--primary:${tokens.primary}`,
    `--primary-foreground:${tokens.primaryForeground}`,
    `--muted:${tokens.muted}`,
    `--muted-foreground:${tokens.mutedForeground}`,
    `--border:${tokens.border}`,
  ].join(";");
}

/**
 * Emit a stylesheet defining CSS variables for every theme: shared tokens on
 * `:root` plus per-theme semantic overrides keyed by `[data-theme="..."]`. The
 * default theme lives on `:root`, so it applies when no/unknown theme is set.
 */
export function themeStylesheet(): string {
  const shared = `--font-sans:${fonts.sans};--radius:${radii.lg}`;
  const root = `:root{${shared};${toCssVars(themes.default)}}`;
  const overrides = themeNames
    .filter((name) => name !== defaultTheme)
    .map((name) => `[data-theme="${name}"]{${toCssVars(themes[name])}}`)
    .join("");
  return `${root}${overrides}`;
}
