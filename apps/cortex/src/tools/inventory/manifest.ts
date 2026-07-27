/**
 * Inventory — identity card (Cortex-SubApp-Standard.md §3).
 *
 * The manifest is how the shell/AI know this tool exists and what it can do,
 * without knowing how it works. Colors/name are references into the central
 * design-system + i18n (§1 law 6), never hard-coded here.
 */
import type { AppManifest } from "@platform/cortex-core";

export const manifest: AppManifest = {
  id: "inventory",
  version: "1.0.0",
  name: { key: "inventory.name" }, // i18n key, not text
  category: "operations",
  icon: "box",
  color: "amber", // from the design-system palette only

  // Permissions/roles the tool needs from the shell (§6). Declared now; enforced
  // once real auth/RBAC is wired to Cortex.
  permissions: ["org.read", "org.write"],
  roles: ["owner", "manager", "employee"],
  // New rows are born org-visible (the DB default today; declared, not silent).
  defaultVisibility: "org",

  // Received ready from the shell — the tool never manages these itself.
  requires: ["auth", "org-context"],

  // Chain reactions (full detail in events.ts). No listeners yet.
  emits: ["inventory.low", "inventory.updated"],
  listensTo: [],

  // What the AI may route to this tool.
  aiTopics: ["inventory", "products", "quantities", "shortages"],
};
