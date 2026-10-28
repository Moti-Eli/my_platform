-- =============================================================================
-- Migration: The Cortex `shifts` tool — `shift_questions` (stage 2)
-- =============================================================================
--
-- The manager's OWN questions for the weekly submission, on top of the three
-- built-in ones (how many shifts min/max, double shifts, a note), which live in
-- TOOL CODE so they are the same for every org and translated.
--
-- One row per question: its text, its kind, its order and whether it is active.
--   kind: 'yes_no' | 'number' | 'text' (short). No option lists, no conditions.
--
-- Questions are never deleted from the UI, only turned OFF (is_active = false):
-- answers are stored on the submission keyed by question id (20261028000008),
-- and an answer must stay readable next to the question it answered. DELETE is
-- still granted (the standard write path) for cleanup by a manager who knows.
--
-- Access model as in stage 1: read by the org tree (employees answer them),
-- write with `shifts.manage`, owner pinned on insert, immutability trigger from
-- birth. Does NOT touch anon or service_role. Alters no other table.
-- =============================================================================

create table public.shift_questions (
  id uuid primary key default gen_random_uuid(),

  owner_id uuid not null references public.users (id),
  org_id   uuid not null references public.organizations (id) on delete cascade,

  visibility text not null default 'org'
    check (visibility in ('private', 'org', 'restricted')),

  label text not null
    check (char_length(label) between 1 and 200),
  kind text not null
    check (kind in ('yes_no', 'number', 'text')),
  position  integer not null default 0,
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table  public.shift_questions           is 'Cortex Shifts tool — the manager''s own questions for the weekly availability submission (stage 2). The three built-in questions live in tool code. Turned off, not deleted. Readable by the org tree; written only with shifts.manage.';
comment on column public.shift_questions.kind      is 'yes_no | number | text (short answer). No option lists, no conditions.';
comment on column public.shift_questions.is_active is 'Off = not asked any more; old answers keep referring to it.';

create index shift_questions_org_id_idx   on public.shift_questions (org_id);
create index shift_questions_owner_id_idx on public.shift_questions (owner_id);

alter table public.shift_questions enable row level security;

grant select, insert, update, delete on public.shift_questions to authenticated;

create policy "read shift questions in your org tree"
  on public.shift_questions for select to authenticated
  using (private.auth_user_can_read('shift_questions', id, org_id, owner_id, visibility));

create policy "insert shift questions you may manage"
  on public.shift_questions for insert to authenticated
  with check (
    private.auth_user_can_write('shift_questions', id, org_id, owner_id, visibility)
    and owner_id = (select auth.uid())
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  );

create policy "update shift questions you may manage"
  on public.shift_questions for update to authenticated
  using (
    private.auth_user_can_write('shift_questions', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  )
  with check (
    private.auth_user_can_write('shift_questions', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  );

create policy "delete shift questions you may manage"
  on public.shift_questions for delete to authenticated
  using (
    private.auth_user_can_write('shift_questions', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'shifts.manage')
  );

create trigger shift_questions_immutable_fields
  before update on public.shift_questions
  for each row
  execute function private.enforce_tool_row_immutability();
