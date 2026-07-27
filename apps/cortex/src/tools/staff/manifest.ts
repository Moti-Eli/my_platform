/**
 * Staff — identity card (Cortex-SubApp-Standard.md §3).
 *
 * The manifest is how the shell/AI know this tool exists and what it can do,
 * without knowing how it works. Colors/name are references into the central
 * design-system + i18n (§1 law 6), never hard-coded here.
 */
import type { AppManifest } from "@platform/cortex-core";

export const manifest: AppManifest = {
  id: "staff",
  version: "1.0.0",
  name: { key: "staff.name" }, // i18n key, not text
  category: "people",
  icon: "user", // resolves to UserIcon in the shell's icon registry
  color: "teal", // a palette token distinct from inventory's amber / tasks' indigo

  // ADMIN-ONLY. `requiresAdmin` dims+locks the catalog card for non-admins, and the
  // tool's route re-checks isAdmin server-side; RLS is the real boundary beneath
  // both. No permission keys are invented (they don't exist in public.permissions)
  // — RLS + requiresAdmin are the gate.
  requiresAdmin: true,
  permissions: [],
  roles: ["owner", "manager", "employee"],
  // New rows are born org-visible (the DB default today; declared, not silent).
  defaultVisibility: "org",

  // Received ready from the shell — the tool never manages these itself.
  requires: ["auth", "org-context"],

  // Read-only this step: nothing emitted, nothing listened to.
  emits: [],
  listensTo: [],

  // What the AI may route to this tool.
  aiTopics: ["staff", "employees", "team", "members"],
};
