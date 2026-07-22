/**
 * Candidates — identity card (Cortex-SubApp-Standard.md §3).
 *
 * The manifest is how the shell/AI know this tool exists and what it can do,
 * without knowing how it works. Colors/name are references into the central
 * design-system + i18n (§1 law 6), never hard-coded here.
 */
import type { AppManifest } from "@platform/cortex-core";

export const manifest: AppManifest = {
  id: "candidates",
  version: "1.0.0",
  name: { key: "candidates.name" }, // i18n key, not text
  category: "business",
  icon: "idcard", // resolves to IdCardIcon in the shell's icon registry
  color: "blue", // a palette token distinct from notes' coral / tasks' indigo / inventory's amber

  // MEMBERSHIP IS THE GATE — no action-level permissions declared, exactly as
  // notes/tasks. The `candidates` table's RLS gates every read/write on org-tree
  // membership (auth_user_can_read / auth_user_can_write); inventing permission
  // keys that don't exist in public.permissions would gate nothing. [] is honest.
  // Candidates are for EVERYONE — no `requiresAdmin`, unlike staff.
  permissions: [],
  roles: ["owner", "manager", "employee"],

  // Received ready from the shell — the tool never manages these itself.
  requires: ["auth", "org-context"],

  // No chain reactions yet: candidates neither emits nor listens (see events.ts).
  emits: [],
  listensTo: [],

  // What the AI may route to this tool.
  aiTopics: ["candidates", "recruiting", "hiring", "onboarding", "applicants"],
};
