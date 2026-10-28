-- =============================================================================
-- Migration: The Cortex `shifts` tool — `shift_weeks` (stage 2: availability)
-- =============================================================================
--
-- Stage 2 lets employees submit weekly availability and the manager see it all.
-- This is the first of its tables: the manager's SETTINGS for one calendar week.
--
-- One row per (org, week_start), where week_start is the week's SUNDAY (weeks
-- start on Sunday, like shift_templates.weekday). Today it holds one setting:
--
--   deadline_at — until when employees may submit/change their availability.
--
-- A week with NO row is the normal case and means "the defaults": the deadline
-- is the WEDNESDAY BEFORE the week at 18:00 (the agreed default). A row appears
-- only when the manager changes something. The default is computed IN TOOL CODE
-- (logic.ts), not as a column default: a Postgres column default cannot depend
-- on another column (week_start), and 18:00 is a LOCAL wall-clock time, which
-- the app resolves on the device. So deadline_at is NOT NULL with no default —
-- the code always writes an explicit value.
--
-- "Close now" = set deadline_at to now; "reopen for everyone" = move
-- deadline_at later. One column, no extra state. Reopening for ONE employee is
-- a separate table (20261028000010): the manager may not write an employee's
-- private submission row, so that setting cannot live on it.
--
-- The deadline is ENFORCED IN TOOL CODE (the server action is the only write
-- path for submissions), not in RLS — checking it in a policy would need a new
-- security function, and stage 2 adds none.
--
-- Access model as in stage 1 (20261008000001): read by the org tree (employees
-- must see the deadline), write with `shifts.manage`, owner pinned on insert,
-- immutability trigger from birth. Does NOT touch anon or service_role.
--
-- Also here (metadata only): the shifts manifest copy in app_definitions drops
-- `requiresAdmin` — from stage 2 the tool is open to every member; the code
-- manifest (apps/cortex/src/tools/shifts/manifest.ts) drops it in the stage-2
-- code PR (#12). Nothing reads this key from app_definitions at runtime. The code registry stays the source of truth; this keeps the display
-- copy honest.
-- =============================================================================

create table public.shift_weeks (
  id uuid primary key default gen_random_uuid(),

  owner_id uuid not null references public.users (id),
  org_id   uuid not null references public.organizations (id) on delete cascade,

  visibility text not null default 'org'
    check (visibility in ('private', 'org', 'restricted')),

  -- The week's Sunday.
  week_start  date not null
    check (extract(dow from week_start) = 0),
  deadline_at timestamptz not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint shift_weeks_org_week_key unique (org_id, week_start)
);

comment on table  public.shift_weeks             is 'Cortex Shifts tool — the manager''s settings for one calendar week (stage 2). No row = defaults (deadline: the Wednesday before, 18:00, computed in tool code). Readable by the org tree; written only with shifts.manage.';
comment on column public.shift_weeks.week_start  is 'The week''s Sunday (weeks start on Sunday, as shift_templates.weekday).';
comment on column public.shift_weeks.deadline_at is 'Until when employees may submit or change availability for this week. Enforced in tool code. "Close now" = now(); "reopen for everyone" = a later time.';

create index shift_weeks_owner_id_idx on public.shift_weeks (owner_id);
-- (org_id is already indexed by the leading column of org_week_key.)

alter table public.shift_weeks enable row level security;

grant select, insert, update, delete on public.shift_weeks to authenticated;

create policy "read shift weeks in your org tree"
  on public.shift_weeks for select to authenticated
  using (private.auth_user_can_read('shift_weeks', id, org_id, owner_id, visibility));

create policy "insert shift weeks you may manage"
  on public.shift_weeks for insert to authenticated
  with check (
    private.auth_user_can_write('shift_weeks', id, org_id, owner_id, visibility)
    and owner_id = (select auth.uid())
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  );

create policy "update shift weeks you may manage"
  on public.shift_weeks for update to authenticated
  using (
    private.auth_user_can_write('shift_weeks', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  )
  with check (
    private.auth_user_can_write('shift_weeks', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  );

create policy "delete shift weeks you may manage"
  on public.shift_weeks for delete to authenticated
  using (
    private.auth_user_can_write('shift_weeks', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  );

create trigger shift_weeks_immutable_fields
  before update on public.shift_weeks
  for each row
  execute function private.enforce_tool_row_immutability();

-- The display copy of the manifest: the tool is open to every member now.
update public.app_definitions
set manifest = manifest - 'requiresAdmin'
where key = 'shifts';
