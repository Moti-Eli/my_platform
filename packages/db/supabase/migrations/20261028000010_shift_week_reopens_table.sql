-- =============================================================================
-- Migration: The Cortex `shifts` tool — `shift_week_reopens` (stage 2)
-- =============================================================================
--
-- "Reopen for ONE employee" (agreed: the manager may let a single employee
-- change their submission after the week's deadline).
--
-- WHY A TABLE AND NOT A COLUMN ON THE SUBMISSION. The plan said "an extra field
-- on the submission". It cannot be: a submission is PRIVATE and owned by the
-- employee, so the MANAGER MAY NOT WRITE IT (auth_user_can_write's private
-- branch is owner-only — the same asymmetry time_entries documents). Letting the
-- manager write one column there would need a new security function or a hole
-- in the model. So the per-employee reopen is a MANAGER-OWNED row here, 'org'
-- like every manager setting, written with `shifts.manage` — and the employee
-- reads it (org tree) to know they may still edit. The code treats a week as
-- open for an employee when now() < the week's deadline OR a row here says
-- now() < reopened_until. Also, an employee with NO submission yet can be
-- reopened (the row does not depend on a submission existing).
--
-- One row per (employee, week); reopening again just moves reopened_until.
--   (employee_id, org_id) → shift_employees (id, org_id) ON DELETE CASCADE.
--
-- Access model as in stage 1: read by the org tree, write with `shifts.manage`,
-- owner pinned on insert, immutability trigger from birth. Does NOT touch anon
-- or service_role.
-- =============================================================================

create table public.shift_week_reopens (
  id uuid primary key default gen_random_uuid(),

  -- Who reopened (the manager), as on every manager-written table.
  owner_id uuid not null references public.users (id),
  org_id   uuid not null references public.organizations (id) on delete cascade,

  visibility text not null default 'org'
    check (visibility in ('private', 'org', 'restricted')),

  employee_id    uuid not null,
  week_start     date not null
    check (extract(dow from week_start) = 0),
  reopened_until timestamptz not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint shift_week_reopens_employee_fk
    foreign key (employee_id, org_id)
    references public.shift_employees (id, org_id) on delete cascade,

  constraint shift_week_reopens_employee_week_key unique (employee_id, week_start)
);

comment on table  public.shift_week_reopens                is 'Cortex Shifts tool — "reopen for one employee" after a week''s deadline (stage 2). A manager-owned setting (the manager cannot write the employee''s private submission). Readable by the org tree; written only with shifts.manage.';
comment on column public.shift_week_reopens.reopened_until is 'The employee may change their submission for week_start until this time.';

create index shift_week_reopens_org_id_idx   on public.shift_week_reopens (org_id);
create index shift_week_reopens_owner_id_idx on public.shift_week_reopens (owner_id);

alter table public.shift_week_reopens enable row level security;

grant select, insert, update, delete on public.shift_week_reopens to authenticated;

create policy "read shift week reopens in your org tree"
  on public.shift_week_reopens for select to authenticated
  using (private.auth_user_can_read('shift_week_reopens', id, org_id, owner_id, visibility));

create policy "insert shift week reopens you may manage"
  on public.shift_week_reopens for insert to authenticated
  with check (
    private.auth_user_can_write('shift_week_reopens', id, org_id, owner_id, visibility)
    and owner_id = (select auth.uid())
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  );

create policy "update shift week reopens you may manage"
  on public.shift_week_reopens for update to authenticated
  using (
    private.auth_user_can_write('shift_week_reopens', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  )
  with check (
    private.auth_user_can_write('shift_week_reopens', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  );

create policy "delete shift week reopens you may manage"
  on public.shift_week_reopens for delete to authenticated
  using (
    private.auth_user_can_write('shift_week_reopens', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  );

create trigger shift_week_reopens_immutable_fields
  before update on public.shift_week_reopens
  for each row
  execute function private.enforce_tool_row_immutability();
