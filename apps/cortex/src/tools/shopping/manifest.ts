/**
 * Shopping — identity card (Cortex-SubApp-Standard.md §3).
 *
 * The manifest is how the shell/AI know this tool exists and what it can do,
 * without knowing how it works. Colors/name are references into the central
 * design-system + i18n (§1 law 6), never hard-coded here.
 *
 * Lists for any purpose (home, office, event). Every list lives in its OWN small
 * root organization (ARCHITECTURE.md #36), so the active org holds at most one
 * list. Stage 1 is a personal list; stage 2 adds invite-by-link sharing.
 */
import type { AppManifest } from "@platform/cortex-core";

export const manifest: AppManifest = {
  id: "shopping",
  version: "1.0.0",
  name: { key: "shopping.name" }, // i18n key, not text
  category: "personal",
  icon: "check", // resolves to CheckIcon in the shell's icon registry — items are checked off
  color: "amber", // palette token (recycling is expected, see the runbook)

  // MEMBERSHIP IS THE GATE — no permission keys, exactly as journal/notes. The
  // shopping tables' RLS (20261022000001) gates every read/write on membership in
  // the list's org; everyone on a list adds and checks items.
  permissions: [],
  roles: ["owner", "manager", "employee"],
  // New rows are born org-visible (the DB default; declared, not silent).
  defaultVisibility: "org",

  requires: ["auth", "org-context"],

  emits: [],
  listensTo: [],

  aiTopics: ["shopping", "list", "groceries", "buy", "items"],
};
