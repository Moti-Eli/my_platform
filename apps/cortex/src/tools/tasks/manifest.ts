/**
 * Tasks — identity card (Cortex-SubApp-Standard.md §3).
 *
 * The manifest is how the shell/AI know this tool exists and what it can do,
 * without knowing how it works. Colors/name are references into the central
 * design-system + i18n (§1 law 6), never hard-coded here.
 */
import type { AppManifest } from "@platform/cortex-core";

export const manifest: AppManifest = {
  id: "tasks",
  version: "1.0.0",
  name: { key: "tasks.name" }, // i18n key, not text
  category: "business",
  icon: "check", // resolves to CheckIcon in the shell's icon registry
  color: "indigo", // a palette token distinct from inventory's amber

  // MEMBERSHIP IS THE GATE — no action-level permissions declared. The `tasks`
  // table's RLS gates every read/write on org-tree membership (auth_user_can_read /
  // auth_user_can_write), and the permission keys inventory's manifest declares
  // ("org.read"/"org.write") DO NOT EXIST in public.permissions — declaring them
  // is dead weight that gates nothing. Tasks does not repeat that: [] is honest.
  permissions: [],
  roles: ["owner", "manager", "employee"],
  // New rows are born org-visible (the DB default today; declared, not silent).
  defaultVisibility: "org",

  // Received ready from the shell — the tool never manages these itself.
  requires: ["auth", "org-context"],

  // Chain reactions (full detail in events.ts). No listeners yet.
  emits: ["tasks.created", "tasks.completed"],
  listensTo: [],

  // What the AI may route to this tool.
  aiTopics: ["tasks", "todo", "reminders", "due dates"],
};
