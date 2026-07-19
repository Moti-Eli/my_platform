-- =============================================================================
-- Migration: The Cortex `expenses` tool table (fourth tool table)
-- =============================================================================
--
-- The fourth Cortex tool table, built on the write-path template inventory_items
-- proved (20260716000002 for the org-tree read shape) and tasks/notes reused
-- (20260717000006 / 20260717000009). Nothing here is novel: it reuses the
-- notes/tasks security model VERBATIM — org-tree read gate, generic
-- auth_user_can_write, visibility default 'org' fail-closed — and, like notes,
-- opens the DELETE path in this same migration.
--
-- -----------------------------------------------------------------------------
-- MEMBERSHIP IN THE ORG TREE IS THE GATE. THERE IS NO ACTION-LEVEL PERMISSION.
-- -----------------------------------------------------------------------------
-- Same decision as notes/tasks/inventory: the row-level gate is
-- `private.auth_user_is_member_of_tree(org_id)`, carried inside `auth_user_can_write`.
-- No `auth_user_has_permission` check is composed in, for the same reason it was
-- omitted there — the Cortex manifest's permission keys do not exist in
-- public.permissions, so wiring one would invent a key no ordinary member could ever
-- hold and lock every member out of their own tool. If a real, grantable expense
-- permission with a UI behind it ever lands, it composes on top
-- (`has_permission(org_id, 'expenses.edit') AND can_write(...)`) without loosening
-- anything here.
--
-- GENERIC can_write — NO NEW FUNCTION. `private.auth_user_can_write`
-- (20260716000006) takes the table name as its FIRST parameter (p_table_name),
-- so it already serves any tool table. `expenses` passes 'expenses' and reuses it
-- as-is; this migration adds no function and touches no existing one.
--
-- FAIL-CLOSED VISIBILITY. `visibility` defaults to 'org' and the SELECT policy
-- admits ONLY 'org'. Rows marked 'private' or 'restricted' are readable by NOBODY
-- through the client API until `record_grants` teaches the policy who may see them
-- — the same deliberate fail-closed default as notes/tasks/inventory_items.
--
-- owner_id IS PINNED IN THE INSERT CHECK. can_write alone does not pin the
-- inserter as owner: on the 'org' branch it returns true for ANY member of the
-- tree. So the INSERT policy adds `owner_id = (select auth.uid())` ON TOP, exactly
-- as notes/tasks/inventory do, so a member cannot stamp a row with someone else's owner_id.
--
-- DELETE REUSES can_write — SAME GATE, NO OWNER-ONLY CARVE-OUT. Anyone who may
-- WRITE a row may DELETE it: the DELETE policy gates on the SAME
-- `private.auth_user_can_write`, not a narrower owner-only check (see 20260717000007's
-- header). A DELETE policy needs USING only, no WITH CHECK — WITH CHECK validates a
-- NEW row, and a delete produces none.
--
-- -----------------------------------------------------------------------------
-- KNOWN GAP: NO IMMUTABILITY TRIGGER ON expenses (the same gap tasks/notes have)
-- -----------------------------------------------------------------------------
-- inventory_items has a trigger (20260716000007... the immutability one) that freezes
-- owner_id, org_id and visibility after insert; tasks and notes deliberately do NOT,
-- and neither does expenses here. This is FLAGGED, NOT FIXED: until an expenses
-- immutability trigger lands, an expense's UPDATE is gated by can_write on both the
-- old row (USING) and the new row (WITH CHECK), but owner_id / org_id / visibility are
-- not yet frozen at the DB level — a member who can write the row could in principle
-- move it to another org they also belong to, or re-stamp its visibility. Both new and
-- old values must still pass can_write, so it cannot escape the writer's own org tree;
-- the gap is narrow, and closing it belongs in a dedicated trigger migration that
-- mirrors inventory's, reviewed on its own.
--
-- Does NOT touch anon or service_role. Does NOT touch any other table.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The table — org-scoped, visibility-bearing, same shape as notes/tasks/inventory.
-- -----------------------------------------------------------------------------
create table public.expenses (
  id       uuid primary key default gen_random_uuid(),

  -- Isolation is org-only. Tabs/branches are CHILD ORGS, not instances.
  owner_id uuid not null references public.users (id),
  org_id   uuid not null references public.organizations (id) on delete cascade,

  visibility text not null default 'org'
    check (visibility in ('private', 'org', 'restricted')),

  amount     numeric(12,2) not null,
  category   text not null default 'general',
  spent_on   date not null default current_date,
  note       text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table  public.expenses            is 'Cortex Expenses tool table. Org-scoped: reads key on org_id and inherit DOWN the org tree. Fourth tool table, reusing the notes/tasks/inventory_items security model verbatim.';
comment on column public.expenses.owner_id   is 'The user who created/owns the row. NOT a read grant on its own — membership in the row''s org tree is required regardless.';
comment on column public.expenses.org_id     is 'Owning organization. NEVER NULL: personal data lives in the user''s personal org.';
comment on column public.expenses.visibility is 'Intended audience: ''org'' (readable by the org tree), ''private'' or ''restricted'' (NOT readable by anyone via RLS until record_grants lands — fail closed by design).';

create index expenses_org_id_idx   on public.expenses (org_id);
create index expenses_owner_id_idx on public.expenses (owner_id);

-- -----------------------------------------------------------------------------
-- 2. RLS — SELECT (fail-closed, membership a blocking AND) + the write path.
-- -----------------------------------------------------------------------------
alter table public.expenses enable row level security;

grant select on public.expenses to authenticated;

create policy "read org-visible expenses in your org tree"
  on public.expenses
  for select
  to authenticated
  using (
    private.auth_user_is_member_of_tree(org_id)
    and visibility = 'org'
  );

-- INSERT + UPDATE + DELETE, all gated by can_write.
grant insert, update, delete on public.expenses to authenticated;

create policy "insert expenses you may write"
  on public.expenses for insert to authenticated
  with check (
    private.auth_user_can_write('expenses', id, org_id, owner_id, visibility)
    and owner_id = (select auth.uid())
  );

create policy "update expenses you may write"
  on public.expenses for update to authenticated
  using      (private.auth_user_can_write('expenses', id, org_id, owner_id, visibility))
  with check (private.auth_user_can_write('expenses', id, org_id, owner_id, visibility));

create policy "delete expenses you may write"
  on public.expenses for delete to authenticated
  using (private.auth_user_can_write('expenses', id, org_id, owner_id, visibility));
