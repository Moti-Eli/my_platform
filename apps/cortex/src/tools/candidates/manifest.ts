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

  // ADMIN-ONLY (for now) — and this MIRRORS THE DB, it does not invent policy.
  // Migration 20260726000001 gates EVERY candidates RLS policy behind the
  // `candidates.access` permission, and that key is deliberately bound to NO role,
  // so today only admins pass it — via the is_admin short-circuit inside
  // auth_user_has_permission. `requiresAdmin` reflects that DB truth in the UI:
  // it dims+locks the catalog card for non-admins, and the tool's route re-checks
  // isAdmin server-side. RLS is the real boundary beneath both; this flag just
  // stops a non-admin from being shown a tool that would only read back empty.
  //
  // STALENESS WARNING: `requiresAdmin` is a stand-in for "holds candidates.access",
  // accurate ONLY while admins are its sole holders. If a non-admin recruiter role
  // is ever granted `candidates.access`, this flag becomes WRONG — it would lock
  // out a recruiter the DB allows — and must be replaced by a real client-side
  // permission check against the held permission, not this boolean.
  //
  // No permission keys are declared here: `permissions` lists keys the tool itself
  // would enforce, and the gate lives in RLS + auth_user_has_permission, not the
  // manifest. [] is honest.
  requiresAdmin: true,
  permissions: [],
  roles: ["owner", "manager", "employee"],
  // New rows are born org-visible (the DB default today; declared, not silent).
  defaultVisibility: "org",

  // Received ready from the shell — the tool never manages these itself.
  requires: ["auth", "org-context"],

  // No chain reactions yet: candidates neither emits nor listens (see events.ts).
  emits: [],
  listensTo: [],

  // What the AI may route to this tool.
  aiTopics: ["candidates", "recruiting", "hiring", "onboarding", "applicants"],
};
