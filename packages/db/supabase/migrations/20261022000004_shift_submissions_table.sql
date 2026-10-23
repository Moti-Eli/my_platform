-- =============================================================================
-- Migration: The Cortex `shifts` tool — `shift_submissions` (stage 2)
-- =============================================================================
--
-- One employee's weekly submission: one row per (employee, week). The answers
-- to the three built-in questions are columns; the marks on the shift table are
-- a child table (20261022000005); the answers to the manager's own questions
-- are a small JSON map (question id → answer) — few questions, always read with
-- the submission, and a question is never deleted (only turned off), so a
-- separate answers table would add a migration and queries for nothing.
--
-- -----------------------------------------------------------------------------
-- BORN 'private', OWNED BY THE EMPLOYEE — the time_entries model, no new function
-- -----------------------------------------------------------------------------
-- The existing rules do exactly what stage 2 needs:
--   * READ  (auth_user_can_read, 'private' branch): the OWNER or an ADMIN of the
--     org tree. The employee sees their own; the manager sees everyone's.
--   * WRITE (auth_user_can_write, 'private' branch): the OWNER only. The employee
--     writes their own; nobody else — not even the manager (the time_entries
--     asymmetry, intended: the manager reviews, never fills in for someone).
-- The tool stamps visibility 'private' explicitly on insert; the column default
-- is the fail-safe half (an omitted value fails CLOSED).
--
-- THE OWNER IS THE EMPLOYEE, BY CONSTRUCTION: the composite FK
--   (employee_id, org_id, owner_id) → shift_employees (id, org_id, user_id)
-- (target added by 20261022000003) means a row can only exist when owner_id IS
-- the employee's user. Removed from the tool → the submissions go too (cascade).
--
-- WHAT A ROW HOLDS
--   week_start   the week's Sunday.
--   min_shifts / max_shifts   how many shifts this week (null = not answered).
--   double_shift 'yes' | 'no' | 'if_needed' (two shifts on one day; "same day"
--                = the shift's start weekday). null = not answered.
--   note         one line to the manager ('' = none).
--   answers      JSON map: shift_questions.id → answer (boolean / number /
--                string). Missing key = not answered.
--   submitted_at when the employee pressed "Submit". Every change saves at
--                once, but the manager's table counts a row as SUBMITTED only
--                with this set (agreed: partial = not submitted).
--
-- DEADLINE: enforced in tool code before every write (see 20261022000001).
-- Does NOT touch anon or service_role.
-- =============================================================================

create table public.shift_submissions (
  id uuid primary key default gen_random_uuid(),

  -- The EMPLOYEE (pinned to employee_id by the composite FK below).
  owner_id uuid not null references public.users (id),
  org_id   uuid not null references public.organizations (id) on delete cascade,

  visibility text not null default 'private'
    check (visibility in ('private', 'org', 'restricted')),

  employee_id uuid not null,
  week_start  date not null
    check (extract(dow from week_start) = 0),

  min_shifts   smallint
    check (min_shifts between 0 and 99),
  max_shifts   smallint
    check (max_shifts between 0 and 99),
  double_shift text
    check (double_shift in ('yes', 'no', 'if_needed')),
  note text not null default ''
    check (char_length(note) <= 500),
  answers jsonb not null default '{}'::jsonb
    check (jsonb_typeof(answers) = 'object'),
  submitted_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint shift_submissions_min_max check (
    min_shifts is null or max_shifts is null or min_shifts <= max_shifts
  ),

  -- owner_id IS the employee's user, same org — or the row cannot exist.
  constraint shift_submissions_employee_fk
    foreign key (employee_id, org_id, owner_id)
    references public.shift_employees (id, org_id, user_id) on delete cascade,

  -- One submission per employee per week.
  constraint shift_submissions_employee_week_key unique (employee_id, week_start),
  -- Composite-FK target for the marks (same org, same owner).
  constraint shift_submissions_id_org_owner_key unique (id, org_id, owner_id)
);

comment on table  public.shift_submissions              is 'Cortex Shifts tool — one employee''s weekly availability submission (stage 2). BORN private, owned by the employee (pinned by composite FK): read by the owner or an org admin, written by the owner only.';
comment on column public.shift_submissions.owner_id     is 'The employee''s user — pinned to employee_id by shift_submissions_employee_fk. Frozen after insert.';
comment on column public.shift_submissions.week_start   is 'The week''s Sunday.';
comment on column public.shift_submissions.double_shift is 'yes | no | if_needed — two shifts on one day (by the shift''s start weekday). null = not answered.';
comment on column public.shift_submissions.answers      is 'JSON map shift_questions.id → answer (boolean / number / string). Missing key = not answered.';
comment on column public.shift_submissions.submitted_at is 'Set by "Submit". Null = saved but not submitted; the manager''s table shows "not submitted".';

create index shift_submissions_org_id_idx   on public.shift_submissions (org_id);
create index shift_submissions_owner_id_idx on public.shift_submissions (owner_id);
-- The manager's week table reads one org's week at once.
create index shift_submissions_org_week_idx on public.shift_submissions (org_id, week_start);

alter table public.shift_submissions enable row level security;

grant select, insert, update, delete on public.shift_submissions to authenticated;

create policy "read shift submissions the user is entitled to"
  on public.shift_submissions for select to authenticated
  using (private.auth_user_can_read('shift_submissions', id, org_id, owner_id, visibility));

create policy "insert shift submissions you may write"
  on public.shift_submissions for insert to authenticated
  with check (
    private.auth_user_can_write('shift_submissions', id, org_id, owner_id, visibility)
    and owner_id = (select auth.uid())
  );

create policy "update shift submissions you may write"
  on public.shift_submissions for update to authenticated
  using      (private.auth_user_can_write('shift_submissions', id, org_id, owner_id, visibility))
  with check (private.auth_user_can_write('shift_submissions', id, org_id, owner_id, visibility));

create policy "delete shift submissions you may write"
  on public.shift_submissions for delete to authenticated
  using (private.auth_user_can_write('shift_submissions', id, org_id, owner_id, visibility));

create trigger shift_submissions_immutable_fields
  before update on public.shift_submissions
  for each row
  execute function private.enforce_tool_row_immutability();
