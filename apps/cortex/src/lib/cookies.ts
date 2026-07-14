/**
 * Preference cookie names + a tiny client-side setter.
 *
 * Language and theme are persisted in cookies (not localStorage) so the server
 * layout can read them and render `<html lang dir data-theme>` correctly on the
 * FIRST paint — no flash, no hydration mismatch. This mirrors the repo's web
 * theming approach (ARCHITECTURE.md #12). "Saved on this device" = the cookie.
 */
export const LANG_COOKIE = "cortex_lang";
export const THEME_COOKIE = "cortex_theme";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Persist a preference cookie (client-side only; call from event handlers). */
export function setPreferenceCookie(name: string, value: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${value}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
}
