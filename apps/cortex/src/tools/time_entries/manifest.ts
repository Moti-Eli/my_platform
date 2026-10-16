/**
 * Time entries — identity card (Cortex-SubApp-Standard.md §3).
 *
 * The manifest is how the shell/AI know this tool exists and what it can do,
 * without knowing how it works. Colors/name are references into the central
 * design-system + i18n (§1 law 6), never hard-coded here.
 */
import type { AppManifest } from "@platform/cortex-core";

export const manifest: AppManifest = {
  id: "time_entries",
  version: "1.0.0",
  name: { key: "time_entries.name" }, // i18n key, not text
  category: "people",
  icon: "clock", // resolves to ClockIcon in the shell's icon registry
  color: "teal", // a palette token; time entries read on the app-teal accent

  // MEMBERSHIP IS THE GATE — no action-level permissions declared, exactly as
  // notes/journal. The `time_entries` table's RLS gates every read/write on
  // org-tree membership + owner/visibility (auth_user_can_read / can_write);
  // inventing permission keys that don't exist in public.permissions would gate
  // nothing. [] is honest. Time entries are for EVERYONE — no `requiresAdmin`.
  permissions: [],
  roles: ["owner", "manager", "employee"],
  // BORN PRIVATE — this is the FIRST tool to declare `defaultVisibility: "private"`,
  // deliberately: a time entry is one person's hours, not org content. The logic
  // stamps this value EXPLICITLY on every insert (logic.ts); the DB column default
  // ('private', 20260723000004) is only the fail-safe half of that pair.
  defaultVisibility: "private",

  // Received ready from the shell — the tool never manages these itself.
  requires: ["auth", "org-context"],

  // No chain reactions yet: time_entries neither emits nor listens (see events.ts).
  emits: [],
  listensTo: [],

  // What the AI may route to this tool.
  aiTopics: ["time", "hours", "timesheet", "work log", "attendance"],
};
