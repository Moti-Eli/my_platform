-- =============================================================================
-- Migration: The Cortex `training` tool — `workout_plans` + `plan_days` + `plan_exercises` (stage 1)
-- =============================================================================
--
-- First tables of the `training` tool (personal workout coaching): a workout
-- plan, its training days ("Day A", strength / cardio) and the exercises on
-- each day. Stage 1 is the plan itself; workout logs, history and goals come
-- in later stages and are NOT here.
--
-- -----------------------------------------------------------------------------
-- ONE PLAN = ONE SMALL ROOT ORGANIZATION
-- -----------------------------------------------------------------------------
-- Same model as the shopping lists (shopping_lists, ARCHITECTURE.md #38): the
-- access model is locked — org-tree membership is a BLOCKING AND on every read
-- and write, and a record grant can only name someone already in the tree — so
-- a plan shared with a coach or a training partner from outside the owner's
-- orgs cannot live in any of those orgs. Every plan gets its OWN root
-- organization (no parent_id), created by the app with
-- `createOrganizationForCurrentUser` (@platform/auth), NOT a child org: a child
-- org is read by its parent's members, so the owner's workplace would see their
-- workout plan.
--
-- Born in its own org, a plan never has to move: `org_id` and `visibility` are
-- immutable (20260716000007). Sharing later = add a membership to the plan's
-- org; no row here changes.
--
-- `workout_plans_org_id_key` makes it exactly one plan per org: the org IS the
-- plan's sharing boundary. Every day and exercise row carries the plan's
-- org_id.
--
-- -----------------------------------------------------------------------------
-- ACCESS MODEL FOR ALL THREE TABLES
-- -----------------------------------------------------------------------------
-- * READ: every member of the plan's org — `private.auth_user_can_read`, rows
--   are 'org'.
-- * WRITE: every member of the plan's org — `private.auth_user_can_write`. No
--   permission key (same posture as `tasks`, 20260717000006).
-- * owner_id (the creating user) pinned on INSERT; immutability trigger
--   (visibility / org_id / owner_id frozen) attached from birth. Every table
--   has owner_id + visibility because the shared RLS helpers and the trigger
--   are keyed on them.
--
-- (id, org_id) is unique on all three tables. On plans and days it lets the
-- child rows reference them with a COMPOSITE foreign key, so the DB refuses a
-- day in a different org than its plan, or an exercise in a different org than
-- its day (as in shopping and orders); on exercises it keeps the same shape
-- for a future child table. Deleting a plan deletes its days; deleting a day
-- deletes its exercises.
--
-- Does NOT touch anon or service_role. Touches no other table. No function is
-- created or altered.
-- =============================================================================

-- 1. The plans.
create table public.workout_plans (
  id uuid primary key default gen_random_uuid(),

  owner_id uuid not null references public.users (id),
  org_id   uuid not null references public.organizations (id) on delete cascade,

  visibility text not null default 'org'
    check (visibility in ('private', 'org', 'restricted')),

  name text not null
    check (char_length(name) <= 100 and name ~ '[^[:space:]]'),
  description text not null default ''
    check (char_length(description) <= 1000),
  frequency_per_week smallint
    check (frequency_per_week between 1 and 7),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint workout_plans_id_org_id_key unique (id, org_id),
  constraint workout_plans_org_id_key    unique (org_id)
);

comment on table  public.workout_plans                    is 'Cortex Training tool — one workout plan per small root organization (the org is the plan''s sharing boundary). Readable and writable by the plan org''s members.';
comment on column public.workout_plans.owner_id           is 'The user who created the plan. Frozen after insert.';
comment on column public.workout_plans.org_id             is 'The plan''s own root organization (one plan per org). Frozen after insert.';
comment on column public.workout_plans.name               is 'Plan name shown to the user (1–100 chars). The org''s name is separate and not shown as the plan name.';
comment on column public.workout_plans.description        is 'Free-text description. '''' = none. Up to 1000 chars.';
comment on column public.workout_plans.frequency_per_week is 'Planned workouts per week (1–7). NULL = not set.';

create index workout_plans_owner_id_idx on public.workout_plans (owner_id);
-- (org_id is already indexed by workout_plans_org_id_key.)

-- 2. The days.
create table public.plan_days (
  id uuid primary key default gen_random_uuid(),

  owner_id uuid not null references public.users (id),
  org_id   uuid not null references public.organizations (id) on delete cascade,

  visibility text not null default 'org'
    check (visibility in ('private', 'org', 'restricted')),

  plan_id uuid not null,

  name text not null
    check (char_length(name) <= 50 and name ~ '[^[:space:]]'),
  day_type text not null default 'strength'
    check (day_type in ('strength', 'cardio')),
  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint plan_days_id_org_id_key unique (id, org_id),

  constraint plan_days_plan_fk
    foreign key (plan_id, org_id)
    references public.workout_plans (id, org_id) on delete cascade
);

comment on table  public.plan_days            is 'Cortex Training tool — a training day of a plan ("Day A"). Same-org with its plan (composite FK); deleting the plan deletes its days.';
comment on column public.plan_days.owner_id   is 'The user who added the day. Frozen after insert.';
comment on column public.plan_days.org_id     is 'Must equal the plan''s org (composite FK). Frozen after insert.';
comment on column public.plan_days.name       is 'Day name (1–50 chars), e.g. "Day A".';
comment on column public.plan_days.day_type   is 'strength | cardio.';
comment on column public.plan_days.sort_order is 'Display order within the plan (ascending).';

create index plan_days_plan_id_idx  on public.plan_days (plan_id);
create index plan_days_org_id_idx   on public.plan_days (org_id);
create index plan_days_owner_id_idx on public.plan_days (owner_id);

-- 3. The exercises.
create table public.plan_exercises (
  id uuid primary key default gen_random_uuid(),

  owner_id uuid not null references public.users (id),
  org_id   uuid not null references public.organizations (id) on delete cascade,

  visibility text not null default 'org'
    check (visibility in ('private', 'org', 'restricted')),

  day_id uuid not null,

  name text not null
    check (char_length(name) <= 100 and name ~ '[^[:space:]]'),
  sets smallint
    check (sets between 1 and 100),
  reps text not null default ''
    check (char_length(reps) <= 20),
  target_weight numeric(6, 2)
    check (target_weight >= 0),
  rest_seconds integer
    check (rest_seconds between 0 and 3600),
  notes text not null default ''
    check (char_length(notes) <= 500),
  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint plan_exercises_id_org_id_key unique (id, org_id),

  constraint plan_exercises_day_fk
    foreign key (day_id, org_id)
    references public.plan_days (id, org_id) on delete cascade
);

comment on table  public.plan_exercises               is 'Cortex Training tool — an exercise on a training day. Same-org with its day (composite FK); deleting the day deletes its exercises.';
comment on column public.plan_exercises.owner_id      is 'The user who added the exercise. Frozen after insert.';
comment on column public.plan_exercises.org_id        is 'Must equal the day''s org (composite FK). Frozen after insert.';
comment on column public.plan_exercises.name          is 'Exercise name (1–100 chars).';
comment on column public.plan_exercises.sets          is 'Number of sets (1–100). NULL = not set (e.g. cardio).';
comment on column public.plan_exercises.reps          is 'Free-text reps ("10", "8-12", "30s"). '''' = none. Up to 20 chars.';
comment on column public.plan_exercises.target_weight is 'Target weight in kg. NULL = none (bodyweight, cardio).';
comment on column public.plan_exercises.rest_seconds  is 'Rest between sets in seconds (0–3600). NULL = not set.';
comment on column public.plan_exercises.notes         is 'Free-text notes. '''' = none. Up to 500 chars.';
comment on column public.plan_exercises.sort_order    is 'Display order within the day (ascending).';

create index plan_exercises_day_id_idx   on public.plan_exercises (day_id);
create index plan_exercises_org_id_idx   on public.plan_exercises (org_id);
create index plan_exercises_owner_id_idx on public.plan_exercises (owner_id);

-- 4. RLS — plans.
alter table public.workout_plans enable row level security;

grant select, insert, update, delete on public.workout_plans to authenticated;

create policy "read workout plans in your org tree"
  on public.workout_plans for select to authenticated
  using (private.auth_user_can_read('workout_plans', id, org_id, owner_id, visibility));

create policy "insert workout plans you may write"
  on public.workout_plans for insert to authenticated
  with check (
    private.auth_user_can_write('workout_plans', id, org_id, owner_id, visibility)
    and owner_id = (select auth.uid())
  );

create policy "update workout plans you may write"
  on public.workout_plans for update to authenticated
  using      (private.auth_user_can_write('workout_plans', id, org_id, owner_id, visibility))
  with check (private.auth_user_can_write('workout_plans', id, org_id, owner_id, visibility));

create policy "delete workout plans you may write"
  on public.workout_plans for delete to authenticated
  using (private.auth_user_can_write('workout_plans', id, org_id, owner_id, visibility));

create trigger workout_plans_immutable_fields
  before update on public.workout_plans
  for each row
  execute function private.enforce_tool_row_immutability();

-- 5. RLS — days.
alter table public.plan_days enable row level security;

grant select, insert, update, delete on public.plan_days to authenticated;

create policy "read plan days in your org tree"
  on public.plan_days for select to authenticated
  using (private.auth_user_can_read('plan_days', id, org_id, owner_id, visibility));

create policy "insert plan days you may write"
  on public.plan_days for insert to authenticated
  with check (
    private.auth_user_can_write('plan_days', id, org_id, owner_id, visibility)
    and owner_id = (select auth.uid())
  );

create policy "update plan days you may write"
  on public.plan_days for update to authenticated
  using      (private.auth_user_can_write('plan_days', id, org_id, owner_id, visibility))
  with check (private.auth_user_can_write('plan_days', id, org_id, owner_id, visibility));

create policy "delete plan days you may write"
  on public.plan_days for delete to authenticated
  using (private.auth_user_can_write('plan_days', id, org_id, owner_id, visibility));

create trigger plan_days_immutable_fields
  before update on public.plan_days
  for each row
  execute function private.enforce_tool_row_immutability();

-- 6. RLS — exercises.
alter table public.plan_exercises enable row level security;

grant select, insert, update, delete on public.plan_exercises to authenticated;

create policy "read plan exercises in your org tree"
  on public.plan_exercises for select to authenticated
  using (private.auth_user_can_read('plan_exercises', id, org_id, owner_id, visibility));

create policy "insert plan exercises you may write"
  on public.plan_exercises for insert to authenticated
  with check (
    private.auth_user_can_write('plan_exercises', id, org_id, owner_id, visibility)
    and owner_id = (select auth.uid())
  );

create policy "update plan exercises you may write"
  on public.plan_exercises for update to authenticated
  using      (private.auth_user_can_write('plan_exercises', id, org_id, owner_id, visibility))
  with check (private.auth_user_can_write('plan_exercises', id, org_id, owner_id, visibility));

create policy "delete plan exercises you may write"
  on public.plan_exercises for delete to authenticated
  using (private.auth_user_can_write('plan_exercises', id, org_id, owner_id, visibility));

create trigger plan_exercises_immutable_fields
  before update on public.plan_exercises
  for each row
  execute function private.enforce_tool_row_immutability();
