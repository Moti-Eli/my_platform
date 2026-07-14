/**
 * Cortex design-system — the SINGLE source of truth for the shell's visual
 * language ("Organic & Fluid", from the Cortex Standard's design-system):
 * rounded 16–24px, soft diffuse shadows (no hard borders), lots of whitespace,
 * clean sans-serif, RTL Hebrew.
 *
 * Components NEVER hard-code colors. They use the Tailwind utilities declared in
 * `globals.css`, which map (via `@theme inline`) onto the CSS variables emitted
 * by {@link tokenStylesheet}. This module is that source — change a value here
 * and it flows to every utility.
 */

/** The core palette (Cortex Standard design-system). */
export const palette = {
  indigo: "#5B4CE0",
  teal: "#12A08E",
  coral: "#F5744F",
  amber: "#DE982B",
  ink: "#221E31",
  screen: "#F7F6FB",
  /** Surface for cards/sheets sitting on the screen. */
  card: "#FFFFFF",
  /** Secondary text / inactive icons (a soft ink). */
  muted: "#7A7690",
  /** The faint tint used instead of hard borders. */
  hairline: "#ECEAF4",
} as const;

/** Corner radii — the "organic" 16–24px range plus a pill for round controls. */
export const radii = {
  md: "16px",
  lg: "20px",
  xl: "24px",
  pill: "999px",
} as const;

/** Soft, diffuse shadows — no hard borders anywhere in the shell. */
export const shadows = {
  /** Resting elevation for cards and the tab bar. */
  soft: "0 8px 30px rgba(34, 30, 49, 0.08)",
  /** Raised elements (sheets, popovers). */
  lifted: "0 16px 44px rgba(34, 30, 49, 0.14)",
  /** The AI hero button — a colored, dominant glow. */
  hero: "0 14px 34px rgba(91, 76, 224, 0.42)",
} as const;

/** Clean, system sans-serif stack (includes a Hebrew fallback). */
export const fontSans =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, "Noto Sans Hebrew", "Arial Hebrew", sans-serif';

/**
 * Emit the tokens as `:root` CSS custom properties. Injected once in the root
 * layout; `globals.css` then references these vars through `@theme inline`, so
 * every Tailwind utility (`bg-indigo`, `text-ink`, `rounded-xl`, `shadow-soft`,
 * …) resolves to a token at runtime. Mirrors the `themeStylesheet()` pattern in
 * `@platform/config`.
 */
export function tokenStylesheet(): string {
  return `:root{
  --ds-indigo:${palette.indigo};
  --ds-teal:${palette.teal};
  --ds-coral:${palette.coral};
  --ds-amber:${palette.amber};
  --ds-ink:${palette.ink};
  --ds-screen:${palette.screen};
  --ds-card:${palette.card};
  --ds-muted:${palette.muted};
  --ds-hairline:${palette.hairline};
  --ds-radius-md:${radii.md};
  --ds-radius-lg:${radii.lg};
  --ds-radius-xl:${radii.xl};
  --ds-shadow-soft:${shadows.soft};
  --ds-shadow-lifted:${shadows.lifted};
  --ds-shadow-hero:${shadows.hero};
  --ds-font-sans:${fontSans};
}`;
}
