/**
 * Cortex design-system — the SINGLE source of truth for the shell's visual
 * language ("Organic & Fluid"): rounded 16–24px, soft diffuse shadows (no hard
 * borders), lots of whitespace, clean sans-serif, RTL Hebrew.
 *
 * TOKEN MODEL (two independent families):
 *
 *   FAMILY A — semantic ROLES (what a colour MEANS). Themes recolour these:
 *     surfaces:  screen, card, ink, muted, hairline
 *     roles:     accent (primary/brand/selected), success, warning, danger
 *     inverse:   inverse (surface always opposite `screen`) + inverseInk (text on it)
 *     scrim:     backdrop dim (ALWAYS darkens)
 *     ring:      focus/selected ring
 *     onFill:    text/icon on ANY saturated fill (see the onFill rule below)
 *
 *   FAMILY B — app IDENTITY palette (a rotating palette apps pick from via
 *     `manifest.color`). Colour names are correct here — this is genuinely a
 *     colour choice, not a role: appViolet, appTeal, appCoral, appAmber,
 *     appBlue, appGreen. They visually coincide with the roles TODAY but are now
 *     independent knobs; later themes may diverge them.
 *
 * THE onFill RULE (locked constraint for theme authors): `onFill` is ONE token,
 * not one per fill. Every saturated fill in a theme — accent, success, warning,
 * danger, and every app-* colour — MUST sit in the same lightness band so that a
 * single contrasting text colour (`onFill`) reads on all of them. Today every
 * fill is dark enough for white, so onFill = #FFFFFF in both themes. A new theme
 * that wants pale fills must move ALL fills together and flip onFill.
 *
 * SUBTLE TINTS: components currently tint fills ad-hoc with Tailwind's `/15`
 * opacity modifier (e.g. `bg-accent/15`). That keeps working and is intentionally
 * NOT tokenised in this round — dedicated subtle-surface tokens are a later
 * design decision. `--ds-accent-rgb` (space-separated channels) is emitted so
 * accent-derived alphas (e.g. shadowHero) stop being hand-copied.
 *
 * THEMING: a theme is just an alternate set of token values, emitted as `--ds-*`
 * CSS variables (per `[data-theme]`, and on `:root` as the default fallback) and
 * mapped onto Tailwind utilities via `@theme inline` in globals.css. Adding a
 * theme = a new entry in {@link themes} — no component changes.
 */

/** The themeable token set. Every theme provides exactly these values. */
export interface ThemeTokens {
  // --- Surfaces / neutrals ---
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

  // --- Family A: semantic roles ---
  /** Primary / brand / selected (today's indigo). */
  accent: string;
  /** Positive / installed / on-track (today's teal). */
  success: string;
  /** Caution / low-stock / over-budget (today's amber). */
  warning: string;
  /** Destructive / urgent (today's coral). */
  danger: string;
  /** A surface that is ALWAYS opposite `screen` (toasts, active hero). */
  inverse: string;
  /** Text/icon on {@link inverse}. */
  inverseInk: string;
  /** Backdrop dim — ALWAYS darkens, in every theme (see values). */
  scrim: string;
  /** Focus / selected ring. */
  ring: string;
  /** Text/icon on ANY saturated fill (accent/success/warning/danger/app-*). */
  onFill: string;

  // --- Family B: app identity palette ---
  appViolet: string;
  appTeal: string;
  appCoral: string;
  appAmber: string;
  appBlue: string;
  appGreen: string;

  // --- Shadows ---
  /** Soft, diffuse shadows (no hard borders). */
  shadowSoft: string;
  shadowLifted: string;
  shadowHero: string;

  /** Accent as space-separated RGB channels (e.g. "91 76 224") for `rgb(… / a)`. */
  accentRgb: string;

  /** Native UA theming for scrollbars/inputs — emitted as `color-scheme`. */
  colorScheme: "light" | "dark";

  /** i18n key for this theme's display name — the theme owns its own label. */
  labelKey: string;
}

/**
 * All themes, keyed by name. `satisfies` validates each entry against
 * {@link ThemeTokens} while keeping the literal keys, so {@link ThemeName} is
 * derived from this object (one source of truth — no hand-written union).
 */
export const themes = {
  light: {
    screen: "#F7F6FB",
    card: "#FFFFFF",
    ink: "#221E31",
    muted: "#7A7690",
    hairline: "#ECEAF4",

    accent: "#5B4CE0",
    success: "#12A08E",
    warning: "#DE982B",
    danger: "#F5744F",
    // inverse = today's light `ink`; inverseInk = white → the toast looks the same.
    inverse: "#221E31",
    inverseInk: "#FFFFFF",
    // scrim ALWAYS darkens (identical in both themes) — deliberate, not a copy
    // of ink; deriving it from ink would LIGHTEN the backdrop in the dark theme.
    scrim: "rgba(20, 18, 32, 0.45)",
    ring: "#5B4CE0",
    onFill: "#FFFFFF",

    // Coincide with the roles today; independent knobs going forward.
    appViolet: "#5B4CE0",
    appTeal: "#12A08E",
    appCoral: "#F5744F",
    appAmber: "#DE982B",
    appBlue: "#3B6FD4",
    appGreen: "#1FA15C",

    shadowSoft: "0 8px 30px rgba(34, 30, 49, 0.08)",
    shadowLifted: "0 16px 44px rgba(34, 30, 49, 0.14)",
    // Was rgba(91, 76, 224, 0.42) — now derived from accentRgb (identical colour).
    shadowHero: "0 14px 34px rgb(var(--ds-accent-rgb) / 0.42)",

    accentRgb: "91 76 224",
    colorScheme: "light",
    labelKey: "settings.themeLight",
  },
  dark: {
    screen: "#141220",
    card: "#211D30",
    ink: "#F4F2FA",
    muted: "#A29DB8",
    hairline: "#322C44",

    accent: "#8577F2",
    success: "#2FBEAA",
    warning: "#ECAE52",
    danger: "#FF8A66",
    // inverse = today's dark `ink` (near-white); inverseInk = dark → FIXES the
    // old bg-ink+text-white toast/hero bug (white-on-near-white in dark).
    inverse: "#F4F2FA",
    inverseInk: "#141220",
    scrim: "rgba(20, 18, 32, 0.45)",
    ring: "#8577F2",
    onFill: "#FFFFFF",

    appViolet: "#8577F2",
    appTeal: "#2FBEAA",
    appCoral: "#FF8A66",
    appAmber: "#ECAE52",
    appBlue: "#6E9BF5",
    appGreen: "#47C97D",

    shadowSoft: "0 8px 30px rgba(0, 0, 0, 0.45)",
    shadowLifted: "0 18px 46px rgba(0, 0, 0, 0.6)",
    // Was rgba(133, 119, 242, 0.5) — now derived from accentRgb (identical colour).
    shadowHero: "0 14px 36px rgb(var(--ds-accent-rgb) / 0.5)",

    accentRgb: "133 119 242",
    colorScheme: "dark",
    labelKey: "settings.themeDark",
  },
} satisfies Record<string, ThemeTokens>;

/** Theme names, derived from {@link themes} (single source of truth). */
export type ThemeName = keyof typeof themes;

export const themeNames = Object.keys(themes) as ThemeName[];
export const defaultTheme: ThemeName = "light";

/**
 * Narrow an untrusted string (e.g. a cookie value) to a known theme. Uses
 * `Object.hasOwn` — `value in themes` would return true for inherited keys like
 * "constructor"/"toString", letting a poisoned cookie set data-theme="constructor".
 */
export function isThemeName(value: string | undefined): value is ThemeName {
  return value !== undefined && Object.hasOwn(themes, value);
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

/**
 * The brand indigo — used for STATIC PWA metadata (viewport theme-color) only.
 * Theme-independent by design: it is a fixed manifest value, not a live token, so
 * it must NOT reach into any theme's tokens.
 */
export const brandColor = "#5B4CE0";

/** `:root` structural tokens (radii, font) — shared by every theme. */
export function baseStylesheet(): string {
  return `:root{
  --ds-radius-md:${radii.md};
  --ds-radius-lg:${radii.lg};
  --ds-radius-xl:${radii.xl};
  --ds-radius-pill:${radii.pill};
  --ds-font-sans:${fontSans};
}`;
}

/** The `--ds-*` colour/shadow declarations for one theme (also sets color-scheme). */
function themeVars(t: ThemeTokens): string {
  return `
  color-scheme:${t.colorScheme};
  --ds-screen:${t.screen};
  --ds-card:${t.card};
  --ds-ink:${t.ink};
  --ds-muted:${t.muted};
  --ds-hairline:${t.hairline};
  --ds-accent:${t.accent};
  --ds-success:${t.success};
  --ds-warning:${t.warning};
  --ds-danger:${t.danger};
  --ds-inverse:${t.inverse};
  --ds-inverse-ink:${t.inverseInk};
  --ds-scrim:${t.scrim};
  --ds-ring:${t.ring};
  --ds-on-fill:${t.onFill};
  --ds-app-violet:${t.appViolet};
  --ds-app-teal:${t.appTeal};
  --ds-app-coral:${t.appCoral};
  --ds-app-amber:${t.appAmber};
  --ds-app-blue:${t.appBlue};
  --ds-app-green:${t.appGreen};
  --ds-accent-rgb:${t.accentRgb};
  --ds-shadow-soft:${t.shadowSoft};
  --ds-shadow-lifted:${t.shadowLifted};
  --ds-shadow-hero:${t.shadowHero};`;
}

/**
 * Per-theme colour/shadow tokens. The DEFAULT theme's values are also emitted on
 * `:root`, so a missing or invalid `data-theme` attribute still renders a correct
 * page (rather than a colourless one).
 */
export function themeStylesheet(): string {
  const rootFallback = `:root{${themeVars(themes[defaultTheme])}\n}`;
  const perTheme = (Object.entries(themes) as Array<[ThemeName, ThemeTokens]>)
    .map(([name, t]) => `[data-theme="${name}"]{${themeVars(t)}\n}`)
    .join("\n");
  return `${rootFallback}\n${perTheme}`;
}
