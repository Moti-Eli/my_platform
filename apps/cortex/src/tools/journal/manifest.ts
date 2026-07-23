/**
 * Journal — identity card (Cortex-SubApp-Standard.md §3).
 *
 * The manifest is how the shell/AI know this tool exists and what it can do,
 * without knowing how it works. Colors/name are references into the central
 * design-system + i18n (§1 law 6), never hard-coded here.
 */
import type { AppManifest } from "@platform/cortex-core";

export const manifest: AppManifest = {
  id: "journal",
  version: "1.0.0",
  name: { key: "journal.name" }, // i18n key, not text
  category: "business",
  icon: "book", // resolves to BookIcon in the shell's icon registry
  color: "blue", // a palette token distinct from inventory's amber / tasks' indigo / staff's teal / notes' coral / expenses' green

  // MEMBERSHIP IS THE GATE — no action-level permissions declared, exactly as
  // notes/expenses. The `journal` table's RLS gates every read/write on org-tree
  // membership (auth_user_can_read / auth_user_can_write); inventing permission
  // keys that don't exist in public.permissions would gate nothing. [] is honest.
  // Journal is for EVERYONE — no `requiresAdmin`, unlike staff.
  permissions: [],
  roles: ["owner", "manager", "employee"],
  // New rows are born org-visible (the DB default today; declared, not silent).
  defaultVisibility: "org",

  // Received ready from the shell — the tool never manages these itself.
  requires: ["auth", "org-context"],

  // No chain reactions yet: journal neither emits nor listens (see events.ts).
  emits: [],
  listensTo: [],

  // What the AI may route to this tool.
  aiTopics: ["journal", "diary", "entries", "log"],
};
