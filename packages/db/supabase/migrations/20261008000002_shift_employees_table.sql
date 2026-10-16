-- =============================================================================
-- Migration: The Cortex `shifts` tool — `shift_employees` (stage 1)
-- =============================================================================
--
-- Who takes part in shifts. The manager adds people to the tool BY HAND (plus a
-- UI "add everyone" button) — not every org member is on the rota (an owner or
-- accountant may not be). One row per member taking part.
--
-- `user_id` is the EMPLOYEE (owner_id is whoever added the row, as on every tool
-- table). The employee must be a member of THIS org: a COMPOSITE foreign key to
-- public.memberships (user_id, organization_id) — that pair is already unique
-- (memberships_user_org_unique) — so the DB refuses an employee from another org
-- or a non-member. This only REFERENCES memberships; it does not alter it. A hard
-- delete of the membership removes the row (cascade); a SOFT-deleted membership
-- (deleted_at) leaves it in place, and the app hides it (decision: hide, don't
-- delete).
--
-- `access_level` is the tool-level ACCESS axis, separate from job positions:
--   'employee'   — default
--   'shift_lead' — אחמ"ש. Stored now, grants NOTHING extra in stage 1.
-- "Manager" is NOT a value here: a manager is an org admin (existing RBAC), so
-- there is one source of truth for it. Only managers change this column
-- (shifts.manage on the write policies).
--
-- Access model as in 20261008000001: read by the org tree, write with
-- shifts.manage, owner pinned on insert, immutability trigger from birth.
--
-- Does NOT touch anon or service_role. Alters no other table.
-- =============================================================================

create table public.shift_employees (
  id uuid primary key default gen_random_uuid(),

  owner_id uuid not null references public.users (id),
  org_id   uuid not null references public.organizations (id) on delete cascade,

  visibility text not null default 'org'
    check (visibility in ('private', 'org', 'restricted')),

  -- The employee (a member of org_id — composite FK below).
  user_id uuid not null,

  access_level text not null default 'employee'
    check (access_level in ('employee', 'shift_lead')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint shift_employees_membership_fk
    foreign key (user_id, org_id)
    references public.memberships (user_id, organization_id) on delete cascade,

  -- Target for shift_employee_positions' composite FK.
  constraint shift_employees_id_org_id_key unique (id, org_id),
  -- A member is in the tool at most once per org.
  constraint shift_employees_org_user_key  unique (org_id, user_id)
);

comment on table  public.shift_employees              is 'Cortex Shifts tool — members taking part in shifts (added by the manager). user_id must be a member of org_id (composite FK to memberships). Readable by the org tree; written only with shifts.manage.';
comment on column public.shift_employees.owner_id     is 'Who added the row (the manager). Frozen after insert.';
comment on column public.shift_employees.user_id      is 'The employee. Must be a member of org_id. A soft-deleted membership leaves this row; the app hides it.';
comment on column public.shift_employees.access_level is 'Tool access level: employee | shift_lead (אחמ"ש). Separate from job positions. Manager = org admin, not stored here. shift_lead grants nothing extra in stage 1.';

create index shift_employees_owner_id_idx on public.shift_employees (owner_id);
create index shift_employees_user_id_idx  on public.shift_employees (user_id);
-- (org_id is already indexed by the leading column of org_user_key.)

alter table public.shift_employees enable row level security;

grant select, insert, update, delete on public.shift_employees to authenticated;

create policy "read shift employees in your org tree"
  on public.shift_employees for select to authenticated
  using (private.auth_user_can_read('shift_employees', id, org_id, owner_id, visibility));

create policy "insert shift employees you may manage"
  on public.shift_employees for insert to authenticated
  with check (
    private.auth_user_can_write('shift_employees', id, org_id, owner_id, visibility)
    and owner_id = (select auth.uid())
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  );

create policy "update shift employees you may manage"
  on public.shift_employees for update to authenticated
  using (
    private.auth_user_can_write('shift_employees', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  )
  with check (
    private.auth_user_can_write('shift_employees', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  );

create policy "delete shift employees you may manage"
  on public.shift_employees for delete to authenticated
  using (
    private.auth_user_can_write('shift_employees', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  );

create trigger shift_employees_immutable_fields
  before update on public.shift_employees
  for each row
  execute function private.enforce_tool_row_immutability();
