-- =============================================================================
-- Migration: The Cortex `shifts` tool — permission key + `shift_positions` (stage 1)
-- =============================================================================
--
-- First table of the `shifts` tool (restaurant staff + shift scheduling). Stage 1
-- is configuration only: positions, which employees take part and in which
-- positions, the weekly shift templates, and how many people each shift needs.
--
-- `shift_positions` = the restaurant's JOB positions (waiter, cook, bartender…),
-- entered by the manager, starting empty. Deliberately NOT the org's RBAC roles
-- (public.roles): changing someone's position must never change what they may do.
--
-- -----------------------------------------------------------------------------
-- ACCESS MODEL FOR EVERY STAGE-1 SHIFTS TABLE (this one and 0002–0005)
-- -----------------------------------------------------------------------------
-- * READ: every member of the org tree — `private.auth_user_can_read`, rows are
--   'org'. Stage 2 lets employees submit availability, and they must be able to
--   see the shifts that exist, so reads are open now rather than reopened later.
-- * WRITE: managers only — `auth_user_can_write` AND
--   `auth_user_has_permission(org_id, 'shifts.manage')`. The key is bound to NO
--   role, so today only org admins pass (is_admin short-circuit) — the same
--   posture as `orders.access` (20261005000001).
-- * owner_id pinned on INSERT; immutability trigger (visibility / org_id /
--   owner_id frozen) attached from birth.
--
-- (id, org_id) is unique so child tables can reference a position with a
-- COMPOSITE foreign key and the DB refuses a link across orgs (as in orders).
--
-- Does NOT touch anon or service_role. Touches no other table beyond registering
-- the permission key in public.permissions. No function is created or altered.
-- =============================================================================

-- 1. The tool's manage permission (idempotent). Bound to no role here.
insert into public.permissions (key, description)
values (
  'shifts.manage',
  'Manage the Shifts tool: positions, employees in the tool, shift templates and staffing requirements.'
)
on conflict (key) do nothing;

-- 2. The table.
create table public.shift_positions (
  id uuid primary key default gen_random_uuid(),

  owner_id uuid not null references public.users (id),
  org_id   uuid not null references public.organizations (id) on delete cascade,

  visibility text not null default 'org'
    check (visibility in ('private', 'org', 'restricted')),

  name     text not null
    check (char_length(name) between 1 and 100),
  position integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint shift_positions_id_org_id_key unique (id, org_id),
  constraint shift_positions_org_name_key  unique (org_id, name)
);

comment on table  public.shift_positions          is 'Cortex Shifts tool — the restaurant''s job positions (waiter, cook…). NOT RBAC roles. Readable by the org tree; written only with shifts.manage.';
comment on column public.shift_positions.name     is 'Position name, chosen by the restaurant (1–100 chars, unique per org).';
comment on column public.shift_positions.position is 'Display order. 0 for all today (sorted by name); reserved for manual reordering.';

create index shift_positions_owner_id_idx on public.shift_positions (owner_id);
-- (org_id is already indexed by the leading column of org_name_key.)

-- 3. RLS.
alter table public.shift_positions enable row level security;

grant select, insert, update, delete on public.shift_positions to authenticated;

create policy "read shift positions in your org tree"
  on public.shift_positions for select to authenticated
  using (private.auth_user_can_read('shift_positions', id, org_id, owner_id, visibility));

create policy "insert shift positions you may manage"
  on public.shift_positions for insert to authenticated
  with check (
    private.auth_user_can_write('shift_positions', id, org_id, owner_id, visibility)
    and owner_id = (select auth.uid())
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  );

create policy "update shift positions you may manage"
  on public.shift_positions for update to authenticated
  using (
    private.auth_user_can_write('shift_positions', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  )
  with check (
    private.auth_user_can_write('shift_positions', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  );

create policy "delete shift positions you may manage"
  on public.shift_positions for delete to authenticated
  using (
    private.auth_user_can_write('shift_positions', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  );

-- 4. Freeze visibility / org_id / owner_id (existing function, 20260716000007).
create trigger shift_positions_immutable_fields
  before update on public.shift_positions
  for each row
  execute function private.enforce_tool_row_immutability();
