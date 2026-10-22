/**
 * Shifts — identity card (Cortex-SubApp-Standard.md §3).
 *
 * The manifest is how the shell/AI know this tool exists and what it can do,
 * without knowing how it works. Colors/name are references into the central
 * design-system + i18n (§1 law 6), never hard-coded here.
 *
 * Restaurant staff + shift scheduling. Stage 1 is configuration: positions,
 * employees in the tool, weekly shift templates and staffing requirements.
 * Stage 2: employees submit weekly availability; the manager sees the table.
 */
import type { AppManifest } from "@platform/cortex-core";

export const manifest: AppManifest = {
  id: "shifts",
  version: "1.0.0",
  name: { key: "shifts.name" }, // i18n key, not text
  category: "people",
  icon: "grid", // resolves to GridIcon — carried over from the catalog placeholder
  color: "coral", // palette token — carried over from the catalog placeholder

  // OPEN TO EVERY ORG MEMBER since stage 2: the route decides per user what to
  // show (manager screens / the employee's own week / "not in the tool" — see
  // the shifts page). RLS is the real boundary: READS are open to the org tree,
  // every write on a shifts table needs `shifts.manage` (20261008000001), bound
  // to NO role — so today only org admins pass. The `requiresAdmin` copy in
  // app_definitions is updated by a stage-2 migration (part 2).
  permissions: [],
  roles: ["owner", "manager", "employee"],
  // New rows are born org-visible (the DB default; declared, not silent).
  defaultVisibility: "org",

  requires: ["auth", "org-context"],

  emits: [],
  listensTo: [],

  aiTopics: ["shifts", "schedule", "rota", "staff", "availability"],
};
