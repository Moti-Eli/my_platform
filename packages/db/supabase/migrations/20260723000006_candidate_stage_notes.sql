-- =============================================================================
-- Migration: Per-stage note columns on public.candidates (acceptance / intake)
-- =============================================================================
--
-- ADDITIVE ONLY. Two free-text columns are appended to the existing
-- `candidates` table (20260722000001) so the acceptance (קבלה) and intake
-- (קליטה) stages each get their own note, instead of both borrowing the single
-- `impression` column as an interim stand-in. Nothing else changes.
--
-- -----------------------------------------------------------------------------
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT TOUCH
-- -----------------------------------------------------------------------------
-- The table is NOT recreated. Its RLS POLICIES, GRANTS, INDEXES and the `stage`
-- CHECK are all left EXACTLY as 20260722000001 defined them. No re-grant, no
-- policy replace: the existing SELECT/INSERT/UPDATE/DELETE policies gate on the
-- ROW (membership in the org tree via auth_user_can_write / the 'org'-visible
-- read), not on any column list, so they already cover these two new columns
-- with no change. `ADD COLUMN IF NOT EXISTS ... NOT NULL DEFAULT ''` backfills
-- every existing row to '' and is safe to re-run.
--
-- STAGE IS STILL COMPUTED IN APPLICATION LOGIC, NOT HERE. These are plain data
-- columns; they do not drive `stage`. The derived-stage rule (contact →
-- interview → intake, from field completeness) lives in the tool's logic.ts, and
-- `stage` remains a plain text column set by moveStage / set_stage. This
-- migration adds NO function, NO trigger, and NO generated column — it would be
-- a mistake to move stage derivation into the database.
--
-- Does NOT touch anon or service_role. Does NOT touch any other table.
-- =============================================================================

alter table public.candidates
  add column if not exists acceptance_note text not null default '',
  add column if not exists intake_note     text not null default '';

comment on column public.candidates.acceptance_note is 'Free text recorded during the ''interview'' (קבלה) stage; '''' when unset.';
comment on column public.candidates.intake_note     is 'Free text recorded during the ''intake'' (קליטה) stage; '''' when unset.';
