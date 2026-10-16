-- =============================================================================
-- Migration: The Cortex `shifts` tool — `shift_employee_positions` (stage 1)
-- =============================================================================
--
-- Which positions each employee CAN fill — one row per (employee, position) pair,
-- so an employee may hold several positions. (Which ONE they fill in a given
-- shift is an assignment detail for stage 3.) An employee with no rows here is
-- allowed in the tool; blocking them from scheduling is a stage-3 rule.
--
-- Same-org guarantees via COMPOSITE foreign keys:
--   (employee_id, org_id) → shift_employees (id, org_id)  ON DELETE CASCADE
--   (position_id, org_id) → shift_positions (id, org_id)  ON DELETE CASCADE
-- Both cascade: a link row means nothing once either side is gone. (Stage-3
-- shift ASSIGNMENTS, which are history, will not cascade.)
--
-- Access model as in 20261008000001: read by the org tree, write with
-- shifts.manage, owner pinned on insert, immutability trigger from birth.
--
-- Does NOT touch anon or service_role. Alters no other table.
-- =============================================================================

create table public.shift_employee_positions (
  id uuid primary key default gen_random_uuid(),

  owner_id uuid not null references public.users (id),
  org_id   uuid not null references public.organizations (id) on delete cascade,

  visibility text not null default 'org'
    check (visibility in ('private', 'org', 'restricted')),

  employee_id uuid not null,
  position_id uuid not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint shift_employee_positions_employee_fk
    foreign key (employee_id, org_id)
    references public.shift_employees (id, org_id) on delete cascade,
  constraint shift_employee_positions_position_fk
    foreign key (position_id, org_id)
    references public.shift_positions (id, org_id) on delete cascade,

  -- An employee holds a position at most once.
  constraint shift_employee_positions_pair_key unique (employee_id, position_id)
);

comment on table public.shift_employee_positions is 'Cortex Shifts tool — which positions each employee can fill (many per employee). Same-org with both sides (composite FKs). Readable by the org tree; written only with shifts.manage.';

create index shift_employee_positions_org_id_idx      on public.shift_employee_positions (org_id);
create index shift_employee_positions_owner_id_idx    on public.shift_employee_positions (owner_id);
create index shift_employee_positions_position_id_idx on public.shift_employee_positions (position_id);
-- (employee_id is already indexed by the leading column of pair_key.)

alter table public.shift_employee_positions enable row level security;

grant select, insert, update, delete on public.shift_employee_positions to authenticated;

create policy "read shift employee positions in your org tree"
  on public.shift_employee_positions for select to authenticated
  using (private.auth_user_can_read('shift_employee_positions', id, org_id, owner_id, visibility));

create policy "insert shift employee positions you may manage"
  on public.shift_employee_positions for insert to authenticated
  with check (
    private.auth_user_can_write('shift_employee_positions', id, org_id, owner_id, visibility)
    and owner_id = (select auth.uid())
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  );

create policy "update shift employee positions you may manage"
  on public.shift_employee_positions for update to authenticated
  using (
    private.auth_user_can_write('shift_employee_positions', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  )
  with check (
    private.auth_user_can_write('shift_employee_positions', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  );

create policy "delete shift employee positions you may manage"
  on public.shift_employee_positions for delete to authenticated
  using (
    private.auth_user_can_write('shift_employee_positions', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  );

create trigger shift_employee_positions_immutable_fields
  before update on public.shift_employee_positions
  for each row
  execute function private.enforce_tool_row_immutability();
