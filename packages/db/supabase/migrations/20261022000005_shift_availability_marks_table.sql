-- =============================================================================
-- Migration: The Cortex `shifts` tool — `shift_availability_marks` (stage 2)
-- =============================================================================
--
-- The employee's marks on the week's shift table: one row per (submission,
-- shift) that was MARKED. mark = 'cannot' (hard constraint) or 'prefer'.
-- NO ROW = CAN. So an unmarked week is "available for everything".
--
-- Same-org, same-owner guarantees via COMPOSITE foreign keys:
--   (submission_id, org_id, owner_id) → shift_submissions (id, org_id, owner_id)
--     ON DELETE CASCADE — a mark belongs to its submission, and its owner IS the
--     submission's owner (the employee), by construction.
--   (template_id, org_id) → shift_templates (id, org_id)  ON DELETE CASCADE
--     — agreed: a shift the manager DELETES takes its marks with it (no shift,
--     nothing to mark; "no row = can" needs no row). A shift the manager
--     CHANGES keeps its marks; the app shows "changed after you submitted" by
--     comparing shift_templates.updated_at with submitted_at.
--
-- Access model = shift_submissions (20261022000004): BORN private, owned by the
-- employee; read by the owner or an org admin, written by the owner only; no
-- new function. Does NOT touch anon or service_role.
-- =============================================================================

create table public.shift_availability_marks (
  id uuid primary key default gen_random_uuid(),

  -- The EMPLOYEE (pinned to the submission's owner by the composite FK below).
  owner_id uuid not null references public.users (id),
  org_id   uuid not null references public.organizations (id) on delete cascade,

  visibility text not null default 'private'
    check (visibility in ('private', 'org', 'restricted')),

  submission_id uuid not null,
  template_id   uuid not null,
  mark text not null
    check (mark in ('cannot', 'prefer')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint shift_availability_marks_submission_fk
    foreign key (submission_id, org_id, owner_id)
    references public.shift_submissions (id, org_id, owner_id) on delete cascade,
  constraint shift_availability_marks_template_fk
    foreign key (template_id, org_id)
    references public.shift_templates (id, org_id) on delete cascade,

  -- One mark per shift per submission.
  constraint shift_availability_marks_pair_key unique (submission_id, template_id)
);

comment on table  public.shift_availability_marks      is 'Cortex Shifts tool — an employee''s marks on the week''s shifts (stage 2): cannot | prefer; no row = can. Private, owned by the employee (pinned to the submission''s owner). A deleted shift takes its marks with it.';
comment on column public.shift_availability_marks.mark is 'cannot (hard constraint) | prefer. A shift with no row = can.';

create index shift_availability_marks_org_id_idx      on public.shift_availability_marks (org_id);
create index shift_availability_marks_owner_id_idx    on public.shift_availability_marks (owner_id);
create index shift_availability_marks_template_id_idx on public.shift_availability_marks (template_id);
-- (submission_id is already indexed by the leading column of pair_key.)

alter table public.shift_availability_marks enable row level security;

grant select, insert, update, delete on public.shift_availability_marks to authenticated;

create policy "read shift availability marks the user is entitled to"
  on public.shift_availability_marks for select to authenticated
  using (private.auth_user_can_read('shift_availability_marks', id, org_id, owner_id, visibility));

create policy "insert shift availability marks you may write"
  on public.shift_availability_marks for insert to authenticated
  with check (
    private.auth_user_can_write('shift_availability_marks', id, org_id, owner_id, visibility)
    and owner_id = (select auth.uid())
  );

create policy "update shift availability marks you may write"
  on public.shift_availability_marks for update to authenticated
  using      (private.auth_user_can_write('shift_availability_marks', id, org_id, owner_id, visibility))
  with check (private.auth_user_can_write('shift_availability_marks', id, org_id, owner_id, visibility));

create policy "delete shift availability marks you may write"
  on public.shift_availability_marks for delete to authenticated
  using (private.auth_user_can_write('shift_availability_marks', id, org_id, owner_id, visibility));

create trigger shift_availability_marks_immutable_fields
  before update on public.shift_availability_marks
  for each row
  execute function private.enforce_tool_row_immutability();
