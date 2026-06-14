/**
 * @platform/core
 * Core business logic, types, and API client
 */

export const coreVersion = "0.1.0";

// Feature registry — the declarative list of platform features and their gates.
// React-free metadata, read by web + mobile (and, in Phase 2, route guards).
// See FEATURES.md at the repo root for the convention.
export type { FeatureDefinition } from "./features/registry";
export { FEATURES } from "./features/registry";
