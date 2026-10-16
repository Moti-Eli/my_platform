/**
 * Shifts — identity card (Cortex-SubApp-Standard.md §3).
 *
 * The manifest is how the shell/AI know this tool exists and what it can do,
 * without knowing how it works. Colors/name are references into the central
 * design-system + i18n (§1 law 6), never hard-coded here.
 *
 * Restaurant staff + shift scheduling. Stage 1 is configuration: positions,
 * employees in the tool, weekly shift templates and staffing requirements.
 */
import type { AppManifest } from "@platform/cortex-core";

export const manifest: AppManifest = {
  id: "shifts",
  version: "1.0.0",
  name: { key: "shifts.name" }, // i18n key, not text
  category: "people",
  icon: "grid", // resolves to GridIcon — carried over from the catalog placeholder
  color: "coral", // palette token — carried over from the catalog placeholder

  // ADMIN-ONLY SCREENS (stage 1). Writes on every shifts table require the
  // `shifts.manage` permission (20261008000001), bound to NO role — so today only
  // org admins pass. READS are open to every org member in the DB on purpose
  // (stage 2: employees submit availability); only the screens are locked now.
  // Same staleness warning as orders/candidates: once a non-admin role holds
  // `shifts.manage`, this boolean must become a real permission check.
  requiresAdmin: true,
  permissions: [],
  roles: ["owner", "manager", "employee"],
  // New rows are born org-visible (the DB default; declared, not silent).
  defaultVisibility: "org",

  requires: ["auth", "org-context"],

  emits: [],
  listensTo: [],

  aiTopics: ["shifts", "schedule", "rota", "staff", "availability"],
};
