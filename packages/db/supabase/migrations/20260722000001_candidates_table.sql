-- =============================================================================
-- Migration: The Cortex `candidates` tool table (fourth tool table)
-- =============================================================================
--
-- The fourth Cortex tool table, built on the write-path template inventory_items
-- proved (20260716000002 for the org-tree read shape) and tasks/notes reused
-- (20260717000006, 20260717000009). Nothing here is novel: it reuses the
-- tasks/inventory/notes security model VERBATIM, and like notes it opens the
-- DELETE path in the same migration (tasks deferred DELETE to 20260717000007;
-- candidates has no reason to withhold it).
--
-- -----------------------------------------------------------------------------
-- MEMBERSHIP IN THE ORG TREE IS THE GATE. THERE IS NO ACTION-LEVEL PERMISSION.
-- -----------------------------------------------------------------------------
-- Same decision as tasks/inventory/notes: the row-level gate is
-- `private.auth_user_is_member_of_tree(org_id)`, carried inside `auth_user_can_write`.
-- No `auth_user_has_permission` check is composed in, for the same reason it was
-- omitted there — the Cortex manifest's permission keys do not exist in
-- public.permissions, so wiring one would invent a key no ordinary member could ever
-- hold and lock every member out of their own tool. If a real, grantable candidate
-- permission with a UI behind it ever lands, it composes on top
-- (`has_permission(org_id, 'candidates.edit') AND can_write(...)`) without loosening
-- anything here.
--
-- GENERIC can_write — NO NEW FUNCTION. `private.auth_user_can_write`
-- (20260716000006) takes the table name as its FIRST parameter (p_table_name),
-- so it already serves any tool table. `candidates` passes 'candidates' and reuses
-- it as-is; this migration adds no function and touches no existing one.
--
-- FAIL-CLOSED VISIBILITY. `visibility` defaults to 'org' and the SELECT policy
-- admits ONLY 'org'. Rows marked 'private' or 'restricted' are readable by NOBODY
-- through the client API until `record_grants` teaches the policy who may see them
-- — the same deliberate fail-closed default as tasks/inventory_items/notes.
--
-- owner_id IS PINNED IN THE INSERT CHECK. can_write alone does not pin the
-- inserter as owner: on the 'org' branch it returns true for ANY member of the
-- tree. So the INSERT policy adds `owner_id = (select auth.uid())` ON TOP, exactly
-- as tasks/inventory/notes do, so a member cannot stamp a row with someone else's
-- owner_id.
--
-- DELETE REUSES can_write — SAME GATE, NO OWNER-ONLY CARVE-OUT. Anyone who may
-- WRITE a row may DELETE it: the DELETE policy gates on the SAME
-- `private.auth_user_can_write`, not a narrower owner-only check (see 20260717000007's
-- header). A DELETE policy needs USING only, no WITH CHECK — WITH CHECK validates a
-- NEW row, and a delete produces none.
--
-- -----------------------------------------------------------------------------
-- KNOWN GAP: NO IMMUTABILITY TRIGGER ON candidates (the same gap tasks/notes have)
-- -----------------------------------------------------------------------------
-- inventory_items has a trigger (20260716000007... the immutability one) that freezes
-- owner_id, org_id and visibility after insert; tasks and notes deliberately do NOT,
-- and neither does candidates here. This is FLAGGED, NOT FIXED: until a candidates
-- immutability trigger lands, a candidate's UPDATE is gated by can_write on both the
-- old row (USING) and the new row (WITH CHECK), but owner_id / org_id / visibility
-- are not yet frozen at the DB level — a member who can write the row could in
-- principle move it to another org they also belong to, or re-stamp its visibility.
-- Both new and old values must still pass can_write, so it cannot escape the writer's
-- own org tree; the gap is narrow, and closing it belongs in a dedicated trigger
-- migration that mirrors inventory's, reviewed on its own.
--
-- Does NOT touch anon or service_role. Does NOT touch any other table.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The table — org-scoped, visibility-bearing, same shape as tasks/notes.
-- -----------------------------------------------------------------------------
create table public.candidates (
  id       uuid primary key default gen_random_uuid(),

  -- Isolation is org-only. Tabs/branches are CHILD ORGS, not instances.
  owner_id uuid not null references public.users (id),
  org_id   uuid not null references public.organizations (id) on delete cascade,

  visibility text not null default 'org'
    check (visibility in ('private', 'org', 'restricted')),

  name          text not null,
  role          text not null default '',
  stage         text not null default 'contact'
    check (stage in ('contact', 'interview', 'intake', 'archived')),
  summary       text not null default '',
  tags          text[] not null default '{}',
  urgent        boolean not null default false,
  reject_reason text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table  public.candidates            is 'Cortex Candidates tool table. Org-scoped: reads key on org_id and inherit DOWN the org tree. Fourth tool table, reusing the tasks/inventory_items/notes security model verbatim.';
comment on column public.candidates.owner_id   is 'The user who created/owns the row. NOT a read grant on its own — membership in the row''s org tree is required regardless.';
comment on column public.candidates.org_id     is 'Owning organization. NEVER NULL: personal data lives in the user''s personal org.';
comment on column public.candidates.visibility is 'Intended audience: ''org'' (readable by the org tree), ''private'' or ''restricted'' (NOT readable by anyone via RLS until record_grants lands — fail closed by design).';

create index candidates_org_id_idx   on public.candidates (org_id);
create index candidates_owner_id_idx on public.candidates (owner_id);

-- -----------------------------------------------------------------------------
-- 2. RLS — SELECT (fail-closed, membership a blocking AND) + the write path.
-- -----------------------------------------------------------------------------
alter table public.candidates enable row level security;

grant select on public.candidates to authenticated;

create policy "read org-visible candidates in your org tree"
  on public.candidates
  for select
  to authenticated
  using (
    private.auth_user_is_member_of_tree(org_id)
    and visibility = 'org'
  );

-- INSERT + UPDATE + DELETE, all gated by can_write.
grant insert, update, delete on public.candidates to authenticated;

create policy "insert candidates you may write"
  on public.candidates for insert to authenticated
  with check (
    private.auth_user_can_write('candidates', id, org_id, owner_id, visibility)
    and owner_id = (select auth.uid())
  );

create policy "update candidates you may write"
  on public.candidates for update to authenticated
  using      (private.auth_user_can_write('candidates', id, org_id, owner_id, visibility))
  with check (private.auth_user_can_write('candidates', id, org_id, owner_id, visibility));

create policy "delete candidates you may write"
  on public.candidates for delete to authenticated
  using (private.auth_user_can_write('candidates', id, org_id, owner_id, visibility));
