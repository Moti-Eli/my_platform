-- =============================================================================
-- Migration: The Cortex `shifts` tool — `shift_templates` (stage 1)
-- =============================================================================
--
-- The recurring weekly shifts: for each day of the week, which shifts exist and
-- their hours. Each day is defined SEPARATELY in the DB; the UI offers "copy to
-- all days", which simply writes rows for the other days.
--
--   weekday:    0 = Sunday … 6 = Saturday (the week starts on Sunday).
--   start_time / end_time: local wall-clock times, no date.
--     end_time EARLIER than start_time means the shift ends the NEXT day
--     (crosses midnight: 18:00 → 02:00). Equal times are refused — a shift
--     must have a length.
--
-- (org_id, weekday, name) is unique — no two "בוקר" shifts on the same day.
-- (id, org_id) is unique as a composite-FK target for shift_requirements.
--
-- Access model as in 20261008000001: read by the org tree, write with
-- shifts.manage, owner pinned on insert, immutability trigger from birth.
--
-- Does NOT touch anon or service_role. Alters no other table.
-- =============================================================================

create table public.shift_templates (
  id uuid primary key default gen_random_uuid(),

  owner_id uuid not null references public.users (id),
  org_id   uuid not null references public.organizations (id) on delete cascade,

  visibility text not null default 'org'
    check (visibility in ('private', 'org', 'restricted')),

  weekday smallint not null
    check (weekday between 0 and 6),
  name text not null
    check (char_length(name) between 1 and 50),
  start_time time not null,
  end_time   time not null,
  position integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- end < start is allowed (ends the next day); equal is not.
  constraint shift_templates_has_length check (end_time <> start_time),

  constraint shift_templates_id_org_id_key       unique (id, org_id),
  constraint shift_templates_org_weekday_name_key unique (org_id, weekday, name)
);

comment on table  public.shift_templates            is 'Cortex Shifts tool — recurring weekly shifts, one set per weekday. Readable by the org tree; written only with shifts.manage.';
comment on column public.shift_templates.weekday    is '0 = Sunday … 6 = Saturday (week starts Sunday).';
comment on column public.shift_templates.start_time is 'Local start time (no date).';
comment on column public.shift_templates.end_time   is 'Local end time (no date). Earlier than start_time = ends the next day (crosses midnight). Never equal to start_time.';
comment on column public.shift_templates.position   is 'Display order within the day. 0 for all today (sorted by start_time).';

create index shift_templates_owner_id_idx on public.shift_templates (owner_id);
-- (org_id + weekday is already indexed by the leading columns of org_weekday_name_key.)

alter table public.shift_templates enable row level security;

grant select, insert, update, delete on public.shift_templates to authenticated;

create policy "read shift templates in your org tree"
  on public.shift_templates for select to authenticated
  using (private.auth_user_can_read('shift_templates', id, org_id, owner_id, visibility));

create policy "insert shift templates you may manage"
  on public.shift_templates for insert to authenticated
  with check (
    private.auth_user_can_write('shift_templates', id, org_id, owner_id, visibility)
    and owner_id = (select auth.uid())
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  );

create policy "update shift templates you may manage"
  on public.shift_templates for update to authenticated
  using (
    private.auth_user_can_write('shift_templates', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  )
  with check (
    private.auth_user_can_write('shift_templates', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  );

create policy "delete shift templates you may manage"
  on public.shift_templates for delete to authenticated
  using (
    private.auth_user_can_write('shift_templates', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  );

create trigger shift_templates_immutable_fields
  before update on public.shift_templates
  for each row
  execute function private.enforce_tool_row_immutability();
