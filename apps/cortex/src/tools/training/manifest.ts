/**
 * Training — identity card (Cortex-SubApp-Standard.md §3).
 *
 * The manifest is how the shell/AI know this tool exists and what it can do,
 * without knowing how it works. Colors/name are references into the central
 * design-system + i18n (§1 law 6), never hard-coded here.
 *
 * A personal workout plan. Every plan lives in its OWN small root organization
 * (ARCHITECTURE.md #38, same model as shopping lists), so the active org holds
 * at most one plan. Stage 1 is the manual plan (plan, days, exercises).
 * Icon/color carry over from the `fitness` catalog placeholder this replaces,
 * matching the seeded app_definitions row (20261028000004).
 */
import type { AppManifest } from "@platform/cortex-core";

export const manifest: AppManifest = {
  id: "training",
  version: "1.0.0",
  name: { key: "training.name" }, // i18n key, not text
  category: "personal",
  icon: "spark",
  color: "amber", // palette token (recycling is expected, see the runbook)

  // MEMBERSHIP IS THE GATE — no permission keys, exactly as shopping. The
  // training tables' RLS (20261028000003) gates every read/write on membership
  // in the plan's org.
  permissions: [],
  roles: ["owner", "manager", "employee"],
  // New rows are born org-visible (the DB default; declared, not silent).
  defaultVisibility: "org",

  requires: ["auth", "org-context"],

  emits: [],
  listensTo: [],

  aiTopics: ["training", "workout", "fitness", "exercise", "gym"],
};
