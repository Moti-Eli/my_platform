/**
 * TEMPORARY stub apps — real registry entries (same {@link AppManifest} shape as
 * a real tool), each flagged `stub: true` with a {@link AppStatus}. They flow
 * through the SAME pipeline as real tools: registered in the registry, listed in
 * the catalog, installable, shown in the chips row and Home. The only difference
 * from a real tool is the `stub` flag (→ a placeholder view) and having no
 * intents/logic. When a real sub-app is built, delete its entry here and register
 * the real manifest instead — the shell, chips, Home and catalog need no change.
 *
 * `coming_soon` stubs are installable and open a placeholder screen;
 * `unavailable` stubs appear in the catalog but cannot be installed yet.
 */
import type { AppManifest, ToolCategory } from "@platform/cortex-core";

/** Build a stub manifest with sensible contract defaults (no intents/roles). */
function stub(
  id: string,
  icon: string,
  color: string,
  category: ToolCategory,
  status: "coming_soon" | "unavailable",
): AppManifest {
  return {
    id,
    version: "0.0.0",
    name: { key: `apps.${id}` }, // i18n key, resolved by the shell
    category,
    icon, // design-system icon id (see components/app-visuals)
    color, // design-system palette token
    permissions: [],
    roles: [],
    // Stubs hold no data, but the contract is required — org, like every tool.
    defaultVisibility: "org",
    requires: [],
    emits: [],
    listensTo: [],
    aiTopics: [],
    stub: true,
    status,
  };
}

export const STUB_APPS: AppManifest[] = [
  // --- Installable: open a working placeholder screen -----------------------
  stub("calendar", "grid", "indigo", "productivity", "coming_soon"),
  stub("contacts", "user", "coral", "people", "coming_soon"),

  // --- Not yet available: shown in the catalog, disabled --------------------
  stub("invoices", "box", "teal", "finance", "unavailable"),
  stub("crm", "user", "indigo", "people", "unavailable"),
  stub("employees", "user", "teal", "people", "unavailable"),
  stub("shifts", "grid", "coral", "people", "unavailable"),
  stub("payroll", "box", "indigo", "finance", "unavailable"),
  stub("bookings", "bell", "teal", "operations", "unavailable"),
  stub("projects", "grid", "amber", "productivity", "unavailable"),
  stub("documents", "pin", "coral", "productivity", "unavailable"),
  stub("analytics", "spark", "indigo", "operations", "unavailable"),
  stub("marketing", "spark", "coral", "operations", "unavailable"),
  stub("support", "chat", "teal", "operations", "unavailable"),
  stub("fitness", "spark", "amber", "personal", "unavailable"),
];
