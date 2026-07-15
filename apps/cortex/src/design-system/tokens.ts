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
 * THE onFill RULE (locked constraint for theme authors): `onFill` is ONE token
 * PER THEME — and it is NOT always white. Every saturated fill in a theme
 * (accent, success, danger, and every app-* colour) MUST sit in ONE lightness
 * band so the SAME `onFill` reaches >=4.5:1 on ALL of them. The LIGHT themes keep
 * dark fills + a white `onFill`; the DARK themes keep light fills + a DARK
 * `onFill` (the screen ink) — both satisfy the band equally (this is exactly what
 * the per-theme `onFill` field is for). `warning` is the ONE exception: it is only
 * ever rendered as text or a `/15` tint, never as a white-on-fill surface, so it
 * is tuned for legibility as text on `card`, NOT for the onFill band — which is
 * why `warning` and `appAmber` are independent values (two knobs, by design).
 *
 * SECOND, EQUAL constraint (light themes): a fill is also used as `text-<role>`
 * on `card` (e.g. `text-danger`, `text-app-teal` inside a `/15` tint). On themes
 * whose `card` is NOT pure white (dawn, clay), text-on-card is STRICTER than
 * white-on-fill, so fills are darkened to clear >=4.5:1 as text on `card`.
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

  // --- Interaction overlays (a translucent tint layered on ANY surface) ---
  /** Hover tint. */
  overlayHover: string;
  /** Press tint — stronger than hover. */
  overlayPressed: string;

  // --- Family B: app identity palette ---
  appViolet: string;
  appTeal: string;
  appCoral: string;
  appAmber: string;
  appBlue: string;
  appGreen: string;

  // --- Shadows (ONLY for things that genuinely float; a card does not) ---
  /** Bottom sheets, popovers, toast — softened depth, not drama. */
  shadowLifted: string;
  /** The AI hero button only. */
  shadowHero: string;

  /** Accent as space-separated RGB channels (e.g. "91 76 224") for `rgb(… / a)`. */
  accentRgb: string;

  /** Native UA theming for scrollbars/inputs — emitted as `color-scheme`. */
  colorScheme: "light" | "dark";

  /** i18n key for this theme's display name — the theme owns its own label. */
  labelKey: string;
}

/**
 * All themes, keyed by name, ordered DARKEST → LIGHTEST (the order the picker
 * shows — it maps `Object.keys(themes)`). `satisfies` validates each entry
 * against {@link ThemeTokens} while keeping the literal keys, so {@link ThemeName}
 * is derived from this object (one source of truth — no hand-written union).
 * Adding a theme = ONE entry here + its `labelKey` strings in i18n. Nothing else.
 *
 * BRAND RULE (locked): `accent` is ONE hue — the indigo/violet — in EVERY theme,
 * only TUNED per background for legibility (lighter/more saturated on the dark
 * themes, deeper on the light ones). It is NEVER changed to a different hue. The
 * SINGLE exception is `clay`, whose accent is a warm dark brown by explicit
 * brief. A future theme author must not drift the accent to another colour.
 *
 * Constraints every theme must hold: `card` visibly distinct from `screen`
 * (surface tone is the only separation now); `hairline` visible on `card`;
 * `onFill` is ONE token so all saturated fills sit in one lightness band;
 * `inverse` opposes `screen`; `scrim` ALWAYS darkens (even dark themes);
 * overlays are black-on-light / white-on-dark; `accentRgb` matches `accent`.
 */
export const themes = {
  // 1. Abyss — the darkest; near-black, deep.
  abyss: {
    screen: "#0B0B12",
    card: "#191922",
    ink: "#F3F2F8",
    muted: "#9C9AAB",
    hairline: "#2E2E3A",

    accent: "#8F82F5",
    success: "#34C6B2",
    warning: "#ECAE52",
    danger: "#FF8E72",
    inverse: "#F3F2F8",
    inverseInk: "#0B0B12",
    // scrim ALWAYS darkens — never a light wash, even on the darkest theme.
    scrim: "rgba(6, 6, 12, 0.55)",
    ring: "#8F82F5",
    // DARK theme: fills stay light, so `onFill` is the dark screen ink (not white)
    // — dark-on-light-fill clears >=4.5:1 on every fill (min 6.24 on accent).
    onFill: "#0B0B12",
    overlayHover: "rgba(255, 255, 255, 0.06)",
    overlayPressed: "rgba(255, 255, 255, 0.10)",

    appViolet: "#8F82F5",
    appTeal: "#34C6B2",
    appCoral: "#FF8E72",
    appAmber: "#ECAE52",
    appBlue: "#6E9BF5",
    appGreen: "#47C97D",

    shadowLifted: "0 12px 32px rgba(0, 0, 0, 0.55)",
    shadowHero: "0 14px 36px rgb(var(--ds-accent-rgb) / 0.5)",

    accentRgb: "143 130 245",
    colorScheme: "dark",
    labelKey: "settings.themeAbyss",
  },
  // 2. Midnight — the previous `dark` theme, values unchanged.
  midnight: {
    screen: "#141220",
    card: "#211D30",
    ink: "#F4F2FA",
    muted: "#A29DB8",
    hairline: "#322C44",

    accent: "#8577F2",
    success: "#2FBEAA",
    warning: "#ECAE52",
    danger: "#FF8A66",
    inverse: "#F4F2FA",
    inverseInk: "#141220",
    scrim: "rgba(20, 18, 32, 0.45)",
    ring: "#8577F2",
    // DARK theme: light fills → dark `onFill` (min 5.20 on accent).
    onFill: "#141220",
    overlayHover: "rgba(255, 255, 255, 0.06)",
    overlayPressed: "rgba(255, 255, 255, 0.10)",

    appViolet: "#8577F2",
    appTeal: "#2FBEAA",
    appCoral: "#FF8A66",
    appAmber: "#ECAE52",
    appBlue: "#6E9BF5",
    appGreen: "#47C97D",

    shadowLifted: "0 12px 31px rgba(0, 0, 0, 0.4)",
    shadowHero: "0 14px 36px rgb(var(--ds-accent-rgb) / 0.5)",

    accentRgb: "133 119 242",
    colorScheme: "dark",
    labelKey: "settings.themeMidnight",
  },
  // 3. Slate — dark but soft; cool grey, lower contrast than midnight.
  slate: {
    screen: "#1E232B",
    card: "#2A3039",
    ink: "#E7ECF2",
    muted: "#9BA6B3",
    hairline: "#3A424D",

    // Lightened from #8B7DF0 so `text-accent` on `card` clears 4.5:1 (was 3.98,
    // now 4.56); still one indigo hue, just a touch lighter for this soft card.
    accent: "#968AF1",
    success: "#3BB89E",
    warning: "#E5B15C",
    danger: "#F58A6E",
    inverse: "#E7ECF2",
    inverseInk: "#1E232B",
    scrim: "rgba(10, 12, 18, 0.5)",
    ring: "#968AF1",
    // DARK theme: light fills → dark `onFill` (min 5.41 on accent).
    onFill: "#1E232B",
    overlayHover: "rgba(255, 255, 255, 0.06)",
    overlayPressed: "rgba(255, 255, 255, 0.10)",

    appViolet: "#968AF1",
    appTeal: "#3BB89E",
    appCoral: "#F58A6E",
    appAmber: "#E5B15C",
    appBlue: "#6E9BF5",
    appGreen: "#4FC07E",

    shadowLifted: "0 12px 30px rgba(0, 0, 0, 0.35)",
    shadowHero: "0 14px 36px rgb(var(--ds-accent-rgb) / 0.5)",

    accentRgb: "150 138 241",
    colorScheme: "dark",
    labelKey: "settings.themeSlate",
  },
  // 4. Dawn — transitional: a dim, warm-neutral LIGHT surface (dark text on light).
  dawn: {
    screen: "#DDD8CF",
    card: "#ECE8E0",
    ink: "#2B2620",
    muted: "#665E54",
    hairline: "#CFC9BE",

    accent: "#574AD6",
    success: "#0B7568",
    warning: "#C9871F",
    danger: "#BA3D19",
    inverse: "#2B2620",
    inverseInk: "#F1ECE4",
    scrim: "rgba(18, 15, 12, 0.42)",
    ring: "#574AD6",
    onFill: "#FFFFFF",
    overlayHover: "rgba(0, 0, 0, 0.04)",
    overlayPressed: "rgba(0, 0, 0, 0.08)",

    appViolet: "#574AD6",
    appTeal: "#0B7568",
    appCoral: "#BA3D19",
    appAmber: "#8C5E16",
    appBlue: "#2C65C4",
    appGreen: "#167744",

    shadowLifted: "0 11px 30px rgba(40, 30, 20, 0.12)",
    shadowHero: "0 14px 34px rgb(var(--ds-accent-rgb) / 0.42)",

    accentRgb: "87 74 214",
    colorScheme: "light",
    labelKey: "settings.themeDawn",
  },
  // 5. Quiet Light — the previous `light` theme, values unchanged. THE DEFAULT.
  quietLight: {
    screen: "#F7F6FB",
    card: "#FFFFFF",
    ink: "#221E31",
    muted: "#7A7690",
    hairline: "#ECEAF4",

    accent: "#5B4CE0",
    success: "#0F8476",
    warning: "#DE982B",
    danger: "#DA3A0C",
    inverse: "#221E31",
    inverseInk: "#FFFFFF",
    scrim: "rgba(20, 18, 32, 0.45)",
    ring: "#5B4CE0",
    onFill: "#FFFFFF",
    overlayHover: "rgba(0, 0, 0, 0.04)",
    overlayPressed: "rgba(0, 0, 0, 0.08)",

    appViolet: "#5B4CE0",
    appTeal: "#0F8476",
    appCoral: "#DA3A0C",
    appAmber: "#A06B19",
    appBlue: "#3B6FD4",
    appGreen: "#1A864D",

    shadowLifted: "0 11px 30px rgba(34, 30, 49, 0.09)",
    shadowHero: "0 14px 34px rgb(var(--ds-accent-rgb) / 0.42)",

    accentRgb: "91 76 224",
    colorScheme: "light",
    labelKey: "settings.themeQuietLight",
  },
  // 6. Clay — warm cream/paper; the "Claude" theme. Accent is a warm dark brown,
  //    the ONE deliberate exception to the brand rule above.
  clay: {
    screen: "#EDE7DC",
    card: "#F7F2E9",
    ink: "#3A2E24",
    muted: "#6E6051",
    hairline: "#DED5C6",

    accent: "#6B4A2E",
    success: "#2E7B59",
    warning: "#B5791E",
    danger: "#B54E37",
    inverse: "#3A2E24",
    inverseInk: "#F7F2E9",
    scrim: "rgba(28, 20, 12, 0.42)",
    ring: "#6B4A2E",
    onFill: "#FFFFFF",
    overlayHover: "rgba(0, 0, 0, 0.04)",
    overlayPressed: "rgba(0, 0, 0, 0.08)",

    // The app palette keeps its own hues — `appViolet` stays violet even though
    // the shell accent here is brown (the palette is independent of the accent).
    appViolet: "#5A47C4",
    appTeal: "#2A7A6A",
    appCoral: "#B54E37",
    appAmber: "#966419",
    appBlue: "#2F6BD0",
    appGreen: "#2E7B59",

    shadowLifted: "0 11px 30px rgba(60, 40, 20, 0.10)",
    shadowHero: "0 14px 34px rgb(var(--ds-accent-rgb) / 0.42)",

    accentRgb: "107 74 46",
    colorScheme: "light",
    labelKey: "settings.themeClay",
  },
} satisfies Record<string, ThemeTokens>;

/** Theme names, derived from {@link themes} (single source of truth). */
export type ThemeName = keyof typeof themes;

export const themeNames = Object.keys(themes) as ThemeName[];
export const defaultTheme: ThemeName = "quietLight";

/**
 * Narrow an untrusted string (e.g. a cookie value) to a known theme. Uses
 * `Object.hasOwn` — `value in themes` would return true for inherited keys like
 * "constructor"/"toString", letting a poisoned cookie set data-theme="constructor".
 */
export function isThemeName(value: string | undefined): value is ThemeName {
  return value !== undefined && Object.hasOwn(themes, value);
}

/**
 * Structural (theme-independent) radii. Tightened under the "Quiet Structure"
 * line — structure comes from tone + spacing, not big soft corners.
 */
export const radii = {
  sm: "10px", //   badges, small tags, inline chips-in-content
  md: "12px", //   buttons, inputs, tiles, non-circular icon discs
  lg: "14px", //   cards, list rows, panels
  xl: "18px", //   bottom sheets / large floating surfaces only
  pill: "999px", // chips, pills (locked)
} as const;

/**
 * Typographic scale — STRUCTURAL, not themeable (lives in {@link baseStylesheet}
 * with the radii; it never changes per theme, so it is NOT part of ThemeTokens).
 *
 * Each role bundles size + line-height + weight as ONE decision — a component
 * picks a role, never a loose size/weight pair, so the two can't drift apart.
 *
 * LOCKED RULE — Hebrew: letter-spacing is ALWAYS `normal` (0) for every role
 * (enforced by the `.type-*` classes in globals.css). Negative tracking is a
 * Latin-display trick that DAMAGES Hebrew rendering — Hebrew letters are not
 * designed to be tightened. This is not a placeholder; never add tracking.
 */
export const type = {
  display: { size: "28px", line: "34px", weight: "600" }, // screen-level title, used sparingly
  title: { size: "20px", line: "26px", weight: "600" }, //   section + screen headers
  heading: { size: "17px", line: "23px", weight: "600" }, // card titles, list-row primary text
  body: { size: "15px", line: "22px", weight: "400" }, //     default reading text
  label: { size: "13px", line: "18px", weight: "500" }, //    secondary text, meta, row subtitles
  caption: { size: "11px", line: "14px", weight: "500" }, //  tab-bar labels, badges, timestamps
} as const;

/**
 * Spacing scale — STRUCTURAL, not themeable (emitted in {@link baseStylesheet}
 * next to radii + type). A coarse, opinionated ramp: fewer choices → fewer wrong
 * ones. Pick a step by the RELATIONSHIP between things, not by the pixel value.
 *
 * NOTE (Tailwind v4): these are ADDED on top of the default numeric ramp, not a
 * replacement — the same `--spacing` base also backs sizing/inset utilities
 * (w-9, h-16, top-2, size-6), which must keep working, so the default ramp is
 * left alive. The scale is enforced by convention + the contract, NOT by clearing
 * the namespace (that would break every width/height/inset utility).
 */
export const space = {
  "2xs": "4px", //  hairline gaps, icon-to-its-own-label
  xs: "8px", //     tight internal padding, chip padding
  sm: "12px", //    default gap between related items
  md: "16px", //    card / screen-edge padding, gap between cards
  lg: "24px", //    gap between sections
  xl: "32px", //    major separation, screen top/bottom breathing
  "2xl": "48px", // empty-state / hero breathing only
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

/** `:root` structural tokens (radii, font, typography) — shared by every theme. */
export function baseStylesheet(): string {
  const typeVars = Object.entries(type)
    .map(
      ([role, t]) =>
        `  --ds-text-${role}-size:${t.size};\n` +
        `  --ds-text-${role}-line:${t.line};\n` +
        `  --ds-text-${role}-weight:${t.weight};`,
    )
    .join("\n");
  const spaceVars = Object.entries(space)
    .map(([name, value]) => `  --ds-space-${name}:${value};`)
    .join("\n");
  return `:root{
  --ds-radius-sm:${radii.sm};
  --ds-radius-md:${radii.md};
  --ds-radius-lg:${radii.lg};
  --ds-radius-xl:${radii.xl};
  --ds-radius-pill:${radii.pill};
  --ds-font-sans:${fontSans};
  --ds-disabled-opacity:0.4;
  --ds-duration-fast:120ms;
  --ds-duration-base:200ms;
  --ds-ease:cubic-bezier(0.16, 1, 0.3, 1);
${typeVars}
${spaceVars}
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
  --ds-overlay-hover:${t.overlayHover};
  --ds-overlay-pressed:${t.overlayPressed};
  --ds-app-violet:${t.appViolet};
  --ds-app-teal:${t.appTeal};
  --ds-app-coral:${t.appCoral};
  --ds-app-amber:${t.appAmber};
  --ds-app-blue:${t.appBlue};
  --ds-app-green:${t.appGreen};
  --ds-accent-rgb:${t.accentRgb};
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
