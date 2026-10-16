-- =============================================================================
-- Migration: Link a candidate RECORD to its candidate USER ACCOUNT (ADDITIVE)
-- =============================================================================
--
-- Adds ONE nullable column, its FK, and a partial index — nothing else. A
-- candidate RECORD (what the recruiter knows about a person; owned by owner_id)
-- and a candidate USER ACCOUNT (an identity in public.users that can log in) are
-- SEPARATE entities. Until now there was no column joining them; this migration
-- adds the single bridge, written only when a candidate is invited to log in.
--
-- ADDITIVE ONLY. The table, its RLS POLICIES (SELECT/INSERT/UPDATE/DELETE), its
-- GRANTS, its existing INDEXES and the immutability TRIGGER (20260722000001) are
-- ALL untouched. Policies gate ROWS, not columns, so the existing org-tree policy
-- already covers this new column with no change. No existing column is modified.
--
-- -----------------------------------------------------------------------------
-- owner_id IS NOT REUSED FOR THIS — THEY ANSWER DIFFERENT QUESTIONS
-- -----------------------------------------------------------------------------
-- owner_id is WHO CREATED the row (the recruiter). candidate_user_id is WHO the
-- row is ABOUT (the invited candidate's login account). They are distinct and
-- must not be conflated: owner_id stays the recruiter's id regardless of whether
-- the candidate ever gets a login. Hence a new column, never an overload of
-- owner_id.
--
-- -----------------------------------------------------------------------------
-- NOT SECURITY-LOAD-BEARING (yet) — DO NOT ASSUME THIS COLUMN GATES ANYTHING
-- -----------------------------------------------------------------------------
-- Who may READ or WRITE a candidate row is STILL governed ENTIRELY by the
-- existing org-tree RLS policy (private.auth_user_is_member_of_tree(org_id) /
-- auth_user_can_write). This column is a plain back-reference; no policy consults
-- it, and none is added or changed here. A future step that lets a candidate read
-- their own row would compose a NEW policy on top — that is not this migration.
--
-- ON-DELETE RULE DIFFERS FROM owner_id BY DESIGN. Tool tables reference
-- public.users via owner_id with NO ACTION (the default) — load-bearing: the row
-- cannot exist without its owner. candidate_user_id instead uses ON DELETE SET
-- NULL: the row belongs to the recruiter (owner_id) and must SURVIVE if the
-- candidate's user account is later deleted — deleting that user detaches the
-- link, it does not delete the record. (record_grants.subject_user_id is the only
-- other nullable users back-reference; it uses CASCADE because a grant is
-- meaningless without its subject. A candidate record is not — so SET NULL.)
--
-- Adds NO function, NO trigger, NO policy. Does NOT touch anon or service_role.
-- Does NOT touch any other table.
-- =============================================================================

alter table public.candidates
  add column if not exists candidate_user_id uuid
    references public.users (id) on delete set null;

comment on column public.candidates.candidate_user_id is
  'Optional bridge from a candidate RECORD to its candidate USER ACCOUNT. The RECORD (what the recruiter knows about a person; owned by owner_id) and the USER ACCOUNT (an identity in public.users that can log in) are SEPARATE entities, and this column is the ONLY link between them. NULL for almost every row: it is written ONLY at the moment a candidate is invited to log in, and stays null until then. FK is ON DELETE SET NULL, NOT owner_id''s NO ACTION: the row belongs to the recruiter via owner_id and must SURVIVE if the linked user account is later deleted — deleting that user detaches this link, it never deletes the candidate row. Not security-load-bearing: who reads/writes the row is governed entirely by the existing org-tree RLS policy, which does not consult this column.';

-- Partial index: almost every row has candidate_user_id IS NULL, so index only
-- the linked rows. Keeps the index small and makes the reverse lookup — "find
-- the candidate record for this user account" — fast.
create index if not exists candidates_candidate_user_id_idx
  on public.candidates (candidate_user_id)
  where candidate_user_id is not null;
