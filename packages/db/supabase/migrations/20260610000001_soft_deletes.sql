-- =============================================================================
-- Migration: Soft deletes for organizations, memberships, messages
-- =============================================================================
--
-- Moves the "delete" semantics for the three tables that carry history/audit
-- value to SOFT DELETE: a nullable `deleted_at timestamptz` (NULL = active). The
-- physical `ON DELETE CASCADE` foreign keys are KEPT for genuine hard purges
-- (and the dev seed's cleanup); soft delete becomes the default for app-level
-- "delete" actions (which set `deleted_at = now()` server-side).
--
-- SCOPE (see ARCHITECTURE.md): organizations, memberships, messages get
-- soft-delete. `users` is DEFERRED (offboarding is modeled as soft-deleting the
-- MEMBERSHIP, not the global identity; a real account-deactivation feature will
-- handle users + auth.users together later). The join tables (role_permissions,
-- membership_roles), `roles`, and the global `permissions` catalog stay
-- hard-delete — their history rides on the soft-deleted parent.
--
-- HOW SOFT-DELETED ROWS ARE HIDDEN (without weakening tenant isolation):
--   1. Each table's SELECT policy gains `deleted_at IS NULL`.
--   2. The recursion-safe membership helpers become deleted_at-aware: a
--      membership counts only if it AND its organization are active. This makes
--      soft-deleting a PARENT cascade the "hidden" state to children for free —
--      soft-deleting an org hides its memberships/roles/messages/etc.; soft-
--      deleting a membership revokes just that user. No downward propagation of
--      `deleted_at` is needed.
--   3. A new `private.org_is_active(org_id)` helper gates the memberships
--      policy's "see my own membership" branch, so a soft-deleted org's
--      memberships disappear even via that branch.
--
-- These changes ONLY ADD `deleted_at IS NULL` filtering — they strictly NARROW
-- visibility and never widen it, so tenant isolation is unchanged: a soft-deleted
-- org's data becomes invisible to its members (intended) and stays invisible to
-- non-members. Soft-delete WRITES are done server-side as `service_role` (which
-- bypasses RLS), sidestepping the UPDATE-then-SELECT policy conflict.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. deleted_at columns (nullable; NULL = active).
-- -----------------------------------------------------------------------------
alter table public.organizations add column deleted_at timestamptz;
alter table public.memberships   add column deleted_at timestamptz;
alter table public.messages      add column deleted_at timestamptz;

comment on column public.organizations.deleted_at is 'Soft-delete marker. NULL = active; non-NULL hides the org (and, via the membership helpers, all its data) from normal reads. Row is retained for history/recovery.';
comment on column public.memberships.deleted_at   is 'Soft-delete marker. NULL = active; non-NULL = the user is offboarded from this org (access revoked, record kept).';
comment on column public.messages.deleted_at       is 'Soft-delete marker. NULL = active; non-NULL hides the message from normal reads while retaining it.';

-- -----------------------------------------------------------------------------
-- 2. New helper: is this organization active (not soft-deleted)?
-- -----------------------------------------------------------------------------
create or replace function private.org_is_active(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organizations o
    where o.id = p_org_id and o.deleted_at is null
  );
$$;

grant execute on function private.org_is_active(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Make the existing membership helpers deleted_at-aware.
--    A membership counts only if the membership AND its org are both active.
--    (CREATE OR REPLACE preserves the existing EXECUTE grants.)
-- -----------------------------------------------------------------------------
create or replace function private.auth_user_is_member_of(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = p_org_id
      and m.user_id = auth.uid()
      and m.deleted_at is null
      and o.deleted_at is null
  );
$$;

create or replace function private.auth_user_shares_org_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships me
    join public.memberships them on them.organization_id = me.organization_id
    join public.organizations o on o.id = me.organization_id
    where me.user_id = auth.uid()
      and them.user_id = p_user_id
      and me.deleted_at is null
      and them.deleted_at is null
      and o.deleted_at is null
  );
$$;

create or replace function private.auth_user_can_access_role(p_role_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.roles r
    join public.memberships m on m.organization_id = r.organization_id
    join public.organizations o on o.id = r.organization_id
    where r.id = p_role_id
      and m.user_id = auth.uid()
      and m.deleted_at is null
      and o.deleted_at is null
  );
$$;

create or replace function private.auth_user_has_permission(
  p_org_id uuid,
  p_permission_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    join public.membership_roles mr on mr.membership_id = m.id
    join public.roles r on r.id = mr.role_id
    where m.user_id = auth.uid()
      and m.organization_id = p_org_id
      and m.deleted_at is null
      and o.deleted_at is null
      and (
        r.is_admin
        or exists (
          select 1
          from public.role_permissions rp
          join public.permissions p on p.id = rp.permission_id
          where rp.role_id = r.id
            and p.key = p_permission_key
        )
      )
  );
$$;

-- -----------------------------------------------------------------------------
-- 4. Update the SELECT policies to hide soft-deleted rows.
--    (The helpers above already hide children of a soft-deleted org; here we add
--     the row's own deleted_at filter, plus org_is_active on the memberships
--     "own row" branch so an offboarded org's memberships vanish too.)
-- -----------------------------------------------------------------------------
alter policy "members can read their organizations"
  on public.organizations
  using ( deleted_at is null and private.auth_user_is_member_of(id) );

alter policy "members can read memberships in their organizations"
  on public.memberships
  using (
    deleted_at is null
    and private.org_is_active(organization_id)
    and (
      user_id = (select auth.uid())
      or private.auth_user_is_member_of(organization_id)
    )
  );

alter policy "members can read their org's messages"
  on public.messages
  using ( deleted_at is null and private.auth_user_is_member_of(organization_id) );

-- -----------------------------------------------------------------------------
-- 5. Partial indexes for the common active-only read paths.
--    (organizations is looked up by PK, so it needs no partial index.)
-- -----------------------------------------------------------------------------
create index memberships_active_org_idx
  on public.memberships (organization_id) where deleted_at is null;
create index messages_active_org_created_idx
  on public.messages (organization_id, created_at) where deleted_at is null;
