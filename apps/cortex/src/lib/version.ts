/**
 * Single source of truth for the Cortex app version.
 *
 * A simple running integer (no dots, no semver): increment by 1 at the end of
 * every unit of work that ends in a commit. Displayed by the Settings screen.
 */
export const APP_VERSION: string = "32";
