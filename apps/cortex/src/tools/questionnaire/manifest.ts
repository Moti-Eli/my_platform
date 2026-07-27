/**
 * Questionnaire — identity card (Cortex-New-Tool-Runbook §1, Standard §3).
 *
 * The candidate-facing questionnaire. It has NO table of its own: it renders the
 * caller's OWN `candidate_answers` rows (20260727000001) — the rows the invite
 * sequence materialised in the candidate's CHILD ORG, owned by the candidate user.
 * A candidate opens this tool inside their child org and answers their questions;
 * the ordinary org-tree RLS on candidate_answers is the whole access model.
 *
 * This manifest is copied verbatim into the `app_definitions` seed
 * (20260727000002); keep the two in sync (the known TS↔JSONB duplication debt).
 * Colours/name are references into the design-system + i18n, never literals here.
 */
import type { AppManifest } from "@platform/cortex-core";

export const manifest: AppManifest = {
  id: "questionnaire",
  version: "1.0.0",
  name: { key: "questionnaire.name" }, // i18n key, not text
  category: "people",
  icon: "document", // resolves to DocumentIcon in the shell's icon registry
  color: "blue", // a palette token — the recruiting family reads on app-blue

  // MEMBERSHIP IS THE GATE — no action-level permissions, exactly like notes/journal
  // /time_entries. candidate_answers' RLS gates every read/write on org-tree
  // membership (auth_user_can_read / can_write); inventing permission keys that
  // aren't in public.permissions would gate nothing. [] is honest. NOT admin-gated:
  // the candidate answering is a plain member of their own child org.
  permissions: [],
  roles: ["owner", "manager", "employee"],
  // Born ORG-visible (the candidate_answers column default). Declared, not silent —
  // a questionnaire answer is visible up the candidate's own org tree (the recruiter
  // in the parent reads it by downward inheritance), never born private.
  defaultVisibility: "org",

  // Received ready from the shell — the tool never manages these itself.
  requires: ["auth", "org-context"],

  // No chain reactions: questionnaire neither emits nor listens (see events.ts).
  emits: [],
  listensTo: [],

  // What the AI may route to this tool.
  aiTopics: ["questionnaire", "answers", "candidate", "intake"],
};
