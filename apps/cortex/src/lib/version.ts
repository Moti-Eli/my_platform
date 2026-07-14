/**
 * Single source of truth for the Cortex app version.
 *
 * The version lives in ONE place — `apps/cortex/package.json`'s `version` field
 * (semver) — and is read here for the UI (Settings shows it). Do not hard-code
 * the version anywhere else. Standing rule: bump `package.json` at the end of
 * every unit of work that ends in a commit — patch for fixes, minor for a new
 * feature/tool, major only at a real user release.
 */
import pkg from "../../package.json";

export const APP_VERSION: string = pkg.version;
