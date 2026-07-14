/**
 * Numeric design tokens for React Native.
 *
 * @platform/config expresses spacing/radii/type in CSS units (rem strings) for
 * the web. RN styles take density-independent numbers, so this module converts
 * the SAME shared tokens once (1rem = 16dp) — screens import from here and
 * never hardcode sizes. Colors are NOT defined here: semantic colors come from
 * `useTheme()`, and accent tints are derived from the shared scale via
 * `withAlpha` below.
 */
import { fontSizes, radii, spacing } from "@platform/config";

const REM = 16;

function toDp(value: string): number {
  const n = parseFloat(value);
  if (Number.isNaN(n)) return 0;
  return value.endsWith("rem") ? n * REM : n;
}

/** Spacing scale (dp): xs=4, sm=8, md=16, lg=24, xl=32, xxl=48. */
export const space = {
  xs: toDp(spacing[1]),
  sm: toDp(spacing[2]),
  md: toDp(spacing[4]),
  lg: toDp(spacing[6]),
  xl: toDp(spacing[8]),
  xxl: toDp(spacing[12]),
} as const;

/** Corner radii (dp): sm=2, md=6, lg=8, xl=16, full=pill. */
export const radius = {
  sm: toDp(radii.sm),
  md: toDp(radii.md),
  lg: toDp(radii.lg),
  xl: toDp(radii.xl),
  full: toDp(radii.full),
} as const;

/** Font sizes (dp): xs=12, sm=14, base=16, lg=18, xl=20, xxl=24. */
export const text = {
  xs: toDp(fontSizes.xs),
  sm: toDp(fontSizes.sm),
  base: toDp(fontSizes.base),
  lg: toDp(fontSizes.lg),
  xl: toDp(fontSizes.xl),
  xxl: toDp(fontSizes["2xl"]),
} as const;

/**
 * Tint a token color with an alpha channel (0..1) — e.g. soft glyph medallions
 * and pressed states that read correctly on BOTH light and dark cards. Input
 * must be a 6-digit hex token from @platform/config.
 */
export function withAlpha(tokenHex: string, alpha: number): string {
  const a = Math.round(Math.min(Math.max(alpha, 0), 1) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${tokenHex}${a}`;
}
