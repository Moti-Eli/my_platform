-- =============================================================================
-- Migration: The Cortex `shifts` tool — `shift_requirements` (stage 1)
-- =============================================================================
--
-- How many people each shift needs, per position: e.g. Friday evening → 3
-- waiters, 2 cooks, 1 bartender. One row per (shift template, position); a
-- position that isn't needed in a shift simply has no row (so the count is
-- always at least 1).
--
-- Same-org guarantees via COMPOSITE foreign keys:
--   (template_id, org_id) → shift_templates (id, org_id)  ON DELETE CASCADE
--     — deleting a shift removes its requirements with it.
--   (position_id, org_id) → shift_positions (id, org_id)  ON DELETE RESTRICT
--     — a position that some shift still requires can NOT be deleted (the UI
--       explains first, as orders does for categories in use). Requirements are
--       configuration the manager set on purpose; they must not vanish silently.
--
-- Access model as in 20261008000001: read by the org tree, write with
-- shifts.manage, owner pinned on insert, immutability trigger from birth.
--
-- Does NOT touch anon or service_role. Alters no other table.
-- =============================================================================

create table public.shift_requirements (
  id uuid primary key default gen_random_uuid(),

  owner_id uuid not null references public.users (id),
  org_id   uuid not null references public.organizations (id) on delete cascade,

  visibility text not null default 'org'
    check (visibility in ('private', 'org', 'restricted')),

  template_id uuid not null,
  position_id uuid not null,

  required_count smallint not null
    check (required_count between 1 and 99),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint shift_requirements_template_fk
    foreign key (template_id, org_id)
    references public.shift_templates (id, org_id) on delete cascade,
  constraint shift_requirements_position_fk
    foreign key (position_id, org_id)
    references public.shift_positions (id, org_id) on delete restrict,

  -- One count per position per shift.
  constraint shift_requirements_template_position_key unique (template_id, position_id)
);

comment on table  public.shift_requirements                is 'Cortex Shifts tool — people needed per position per shift template. Same-org with both sides (composite FKs). Readable by the org tree; written only with shifts.manage.';
comment on column public.shift_requirements.required_count is 'How many people in this position the shift needs (1–99). A position not needed has no row.';

create index shift_requirements_org_id_idx      on public.shift_requirements (org_id);
create index shift_requirements_owner_id_idx    on public.shift_requirements (owner_id);
create index shift_requirements_position_id_idx on public.shift_requirements (position_id);
-- (template_id is already indexed by the leading column of template_position_key.)

alter table public.shift_requirements enable row level security;

grant select, insert, update, delete on public.shift_requirements to authenticated;

create policy "read shift requirements in your org tree"
  on public.shift_requirements for select to authenticated
  using (private.auth_user_can_read('shift_requirements', id, org_id, owner_id, visibility));

create policy "insert shift requirements you may manage"
  on public.shift_requirements for insert to authenticated
  with check (
    private.auth_user_can_write('shift_requirements', id, org_id, owner_id, visibility)
    and owner_id = (select auth.uid())
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  );

create policy "update shift requirements you may manage"
  on public.shift_requirements for update to authenticated
  using (
    private.auth_user_can_write('shift_requirements', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  )
  with check (
    private.auth_user_can_write('shift_requirements', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  );

create policy "delete shift requirements you may manage"
  on public.shift_requirements for delete to authenticated
  using (
    private.auth_user_can_write('shift_requirements', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  );

create trigger shift_requirements_immutable_fields
  before update on public.shift_requirements
  for each row
  execute function private.enforce_tool_row_immutability();
