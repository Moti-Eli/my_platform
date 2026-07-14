/**
 * Cortex design-system — the SINGLE source of truth for the shell's visual
 * language ("Organic & Fluid", from the Cortex Standard's design-system):
 * rounded 16–24px, soft diffuse shadows (no hard borders), lots of whitespace,
 * clean sans-serif, RTL Hebrew.
 *
 * THEMING: a theme is just an alternate set of token *values* — components never
 * hard-code colors, they use the Tailwind utilities in `globals.css` which map
 * (via `@theme inline`) onto the `--ds-*` CSS variables. The themeable tokens
 * are emitted per `[data-theme="…"]` by {@link themeStylesheet}; structural
 * tokens (radii, font) are global via {@link baseStylesheet}. Adding a new theme
 * later (Midnight/Aurora/…) is just adding an entry to {@link themes} — no
 * component changes.
 */

/** The themeable token set. Every theme provides exactly these values. */
export interface ThemeTokens {
  /** App background. */
  screen: string;
  /** Card/sheet surface sitting on the screen. */
  card: string;
  /** Primary text / icons. */
  ink: string;
  /** Secondary text / inactive icons. */
  muted: string;
  /** Faint tint used instead of hard borders. */
  hairline: string;
  /** Brand accents. */
  indigo: string;
  teal: string;
  coral: string;
  amber: string;
  /** Soft, diffuse shadows (no hard borders). */
  shadowSoft: string;
  shadowLifted: string;
  shadowHero: string;
}

export type ThemeName = "light" | "dark";

/** All themes, keyed by name. Add a new theme here — nothing else changes. */
export const themes: Record<ThemeName, ThemeTokens> = {
  light: {
    screen: "#F7F6FB",
    card: "#FFFFFF",
    ink: "#221E31",
    muted: "#7A7690",
    hairline: "#ECEAF4",
    indigo: "#5B4CE0",
    teal: "#12A08E",
    coral: "#F5744F",
    amber: "#DE982B",
    shadowSoft: "0 8px 30px rgba(34, 30, 49, 0.08)",
    shadowLifted: "0 16px 44px rgba(34, 30, 49, 0.14)",
    shadowHero: "0 14px 34px rgba(91, 76, 224, 0.42)",
  },
  dark: {
    screen: "#141220",
    card: "#211D30",
    ink: "#F4F2FA",
    muted: "#A29DB8",
    hairline: "#322C44",
    indigo: "#8577F2",
    teal: "#2FBEAA",
    coral: "#FF8A66",
    amber: "#ECAE52",
    shadowSoft: "0 8px 30px rgba(0, 0, 0, 0.45)",
    shadowLifted: "0 18px 46px rgba(0, 0, 0, 0.6)",
    shadowHero: "0 14px 36px rgba(133, 119, 242, 0.5)",
  },
};

export const themeNames = Object.keys(themes) as ThemeName[];
export const defaultTheme: ThemeName = "light";

/** Narrow an untrusted string (e.g. a cookie value) to a known theme. */
export function isThemeName(value: string | undefined): value is ThemeName {
  return value !== undefined && value in themes;
}

/** Structural (theme-independent) tokens: the "organic" radii and the font. */
export const radii = {
  md: "16px",
  lg: "20px",
  xl: "24px",
  pill: "999px",
} as const;

/** Clean, system sans-serif stack (includes a Hebrew fallback). */
export const fontSans =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, "Noto Sans Hebrew", "Arial Hebrew", sans-serif';

/** The brand indigo (light) — used for static metadata like the PWA theme color. */
export const brandColor = themes.light.indigo;

/** `:root` structural tokens (radii, font) — shared by every theme. */
export function baseStylesheet(): string {
  return `:root{
  --ds-radius-md:${radii.md};
  --ds-radius-lg:${radii.lg};
  --ds-radius-xl:${radii.xl};
  --ds-font-sans:${fontSans};
}`;
}

/** Per-theme color/shadow tokens, scoped by `[data-theme="…"]`. */
export function themeStylesheet(): string {
  return (Object.entries(themes) as Array<[ThemeName, ThemeTokens]>)
    .map(
      ([name, t]) => `[data-theme="${name}"]{
  --ds-screen:${t.screen};
  --ds-card:${t.card};
  --ds-ink:${t.ink};
  --ds-muted:${t.muted};
  --ds-hairline:${t.hairline};
  --ds-indigo:${t.indigo};
  --ds-teal:${t.teal};
  --ds-coral:${t.coral};
  --ds-amber:${t.amber};
  --ds-shadow-soft:${t.shadowSoft};
  --ds-shadow-lifted:${t.shadowLifted};
  --ds-shadow-hero:${t.shadowHero};
}`,
    )
    .join("\n");
}
