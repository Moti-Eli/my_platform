-- =============================================================================
-- Migration: The Cortex `tasks` tool table (second tool table)
-- =============================================================================
--
-- The second Cortex tool table, and the first built entirely on the write-path
-- template that inventory_items proved (20260716000002 for the org-tree read
-- shape, 20260717000005 for the grant + write policies). Nothing here is novel:
-- it reuses the inventory security model VERBATIM.
--
-- -----------------------------------------------------------------------------
-- MEMBERSHIP IN THE ORG TREE IS THE GATE. THERE IS NO ACTION-LEVEL PERMISSION.
-- -----------------------------------------------------------------------------
-- Same decision as inventory (20260717000005's header, at length): the row-level
-- gate is `private.auth_user_is_member_of_tree(org_id)`, carried inside
-- `auth_user_can_write`. No `auth_user_has_permission` check is composed in, for
-- the same reason it was omitted there — the Cortex manifest's permission keys do
-- not exist in public.permissions, so wiring one would invent a key no ordinary
-- member could ever hold and lock every member out of their own tool. If a real,
-- grantable task permission with a UI behind it ever lands, it composes on top
-- (`has_permission(org_id, 'tasks.edit') AND can_write(...)`) without loosening
-- anything here.
--
-- GENERIC can_write — NO NEW FUNCTION. `private.auth_user_can_write`
-- (20260716000006) takes the table name as its FIRST parameter (p_table_name),
-- so it already serves any tool table. `tasks` passes 'tasks' and reuses it as-is;
-- this migration adds no function and touches no existing one.
--
-- FAIL-CLOSED VISIBILITY. `visibility` defaults to 'org' and the SELECT policy
-- admits ONLY 'org'. Rows marked 'private' or 'restricted' are readable by NOBODY
-- through the client API until `record_grants` teaches the policy who may see them
-- — the same deliberate fail-closed default as inventory_items.
--
-- owner_id IS PINNED IN THE INSERT CHECK. can_write alone does not pin the
-- inserter as owner: on the 'org' branch it returns true for ANY member of the
-- tree. So the INSERT policy adds `owner_id = (select auth.uid())` ON TOP, exactly
-- as inventory does, so a member cannot stamp a row with someone else's owner_id.
--
-- DELETE STAYS DENIED. NOT AN OMISSION. No grant and no policy for DELETE:
-- `authenticated` keeps zero DELETE privilege, so a delete returns 42501 and reads
-- as "unavailable" — the same fail-closed answer as inventory. There is no delete
-- caller to serve yet; when one exists it gets its own policy in its own migration.
--
-- -----------------------------------------------------------------------------
-- KNOWN GAP: NO IMMUTABILITY TRIGGER ON tasks (unlike inventory's 20260716000007)
-- -----------------------------------------------------------------------------
-- inventory_items has a trigger (20260716000007) that freezes owner_id, org_id and
-- visibility after insert; the inventory UPDATE policy leans on it (USING and WITH
-- CHECK are identical precisely because those immutable columns cannot change). No
-- such trigger is added for tasks here. This is FLAGGED, NOT FIXED: until a tasks
-- immutability trigger lands, a task's UPDATE is gated by can_write on both the old
-- row (USING) and the new row (WITH CHECK), but owner_id / org_id / visibility are
-- not yet frozen at the DB level — a member who can write the row could in
-- principle move it to another org they also belong to, or re-stamp its
-- visibility. Both new and old values must still pass can_write, so it cannot
-- escape the writer's own org tree; the gap is narrow, and closing it belongs in a
-- dedicated trigger migration that mirrors 20260716000007, reviewed on its own.
--
-- Does NOT touch anon or service_role. Does NOT touch any other table.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The table — org-scoped, visibility-bearing, same shape as inventory_items.
-- -----------------------------------------------------------------------------
create table public.tasks (
  id       uuid primary key default gen_random_uuid(),

  -- Isolation is org-only. Tabs/branches are CHILD ORGS, not instances.
  owner_id uuid not null references public.users (id),
  org_id   uuid not null references public.organizations (id) on delete cascade,

  visibility text not null default 'org'
    check (visibility in ('private', 'org', 'restricted')),

  title      text not null,
  done       boolean not null default false,
  due_date   timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table  public.tasks            is 'Cortex Tasks tool table. Org-scoped: reads key on org_id and inherit DOWN the org tree. Second tool table, reusing inventory_items'' security model verbatim.';
comment on column public.tasks.owner_id   is 'The user who created/owns the row. NOT a read grant on its own — membership in the row''s org tree is required regardless.';
comment on column public.tasks.org_id     is 'Owning organization. NEVER NULL: personal data lives in the user''s personal org.';
comment on column public.tasks.visibility is 'Intended audience: ''org'' (readable by the org tree), ''private'' or ''restricted'' (NOT readable by anyone via RLS until record_grants lands — fail closed by design).';

create index tasks_org_id_idx   on public.tasks (org_id);
create index tasks_owner_id_idx on public.tasks (owner_id);

-- -----------------------------------------------------------------------------
-- 2. RLS — SELECT (fail-closed, membership a blocking AND) + the write path.
-- -----------------------------------------------------------------------------
alter table public.tasks enable row level security;

grant select on public.tasks to authenticated;

create policy "read org-visible tasks in your org tree"
  on public.tasks
  for select
  to authenticated
  using (
    private.auth_user_is_member_of_tree(org_id)
    and visibility = 'org'
  );

-- INSERT + UPDATE only. NOT delete (see header — deliberate).
grant insert, update on public.tasks to authenticated;

create policy "insert tasks you may write"
  on public.tasks for insert to authenticated
  with check (
    private.auth_user_can_write('tasks', id, org_id, owner_id, visibility)
    and owner_id = (select auth.uid())
  );

create policy "update tasks you may write"
  on public.tasks for update to authenticated
  using      (private.auth_user_can_write('tasks', id, org_id, owner_id, visibility))
  with check (private.auth_user_can_write('tasks', id, org_id, owner_id, visibility));
