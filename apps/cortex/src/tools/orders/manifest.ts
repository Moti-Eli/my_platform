/**
 * Orders — identity card (Cortex-SubApp-Standard.md §3).
 *
 * The manifest is how the shell/AI know this tool exists and what it can do,
 * without knowing how it works. Colors/name are references into the central
 * design-system + i18n (§1 law 6), never hard-coded here.
 *
 * Stage 1 of 4: suppliers only. Later stages (per-supplier catalog, building an
 * order, sending it over WhatsApp) extend THIS tool — they are not separate tools.
 */
import type { AppManifest } from "@platform/cortex-core";

export const manifest: AppManifest = {
  id: "orders",
  version: "1.0.0",
  name: { key: "orders.name" }, // i18n key, not text
  category: "operations",
  icon: "send", // resolves to SendIcon in the shell's icon registry — an order goes out to a supplier
  color: "green", // palette token; shared with expenses (recycling is expected, see the runbook)

  // ADMIN-ONLY (for now) — and this MIRRORS THE DB, it does not invent policy.
  // Migration 20261005000001 gates EVERY suppliers RLS policy behind the tool-wide
  // `orders.access` permission, bound to NO role, so today only admins pass it —
  // via the is_admin short-circuit inside auth_user_has_permission. Same posture
  // and same STALENESS WARNING as candidates: once a non-admin role is granted
  // `orders.access`, this boolean becomes wrong and must be replaced by a real
  // client-side check against the held permission.
  //
  // `roles` below is descriptive only — nothing reads it to grant access today.
  requiresAdmin: true,
  permissions: [],
  roles: ["owner", "manager", "employee"],
  // New rows are born org-visible (the DB default today; declared, not silent).
  defaultVisibility: "org",

  // Received ready from the shell — the tool never manages these itself.
  requires: ["auth", "org-context"],

  // No chain reactions yet: orders neither emits nor listens (see events.ts).
  emits: [],
  listensTo: [],

  // What the AI may route to this tool.
  aiTopics: ["orders", "suppliers", "purchasing", "vendors"],
};
