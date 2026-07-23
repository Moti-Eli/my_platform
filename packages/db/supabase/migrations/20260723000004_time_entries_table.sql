-- =============================================================================
-- Migration: The Cortex `time_entries` tool table (seventh tool table)
-- =============================================================================
--
-- The seventh Cortex tool table — and the FIRST whose rows are BORN 'private'.
-- Structure follows the journal/notes/expenses template (20260717000011 et al.);
-- the security wiring deliberately does NOT: a table of private rows needs the
-- full `auth_user_can_read` read path and the immutability trigger from day one,
-- both of which the 'org'-default tables postponed or skipped.
--
-- -----------------------------------------------------------------------------
-- BORN 'private' — THE ONE PLACE THIS TABLE DIFFERS FROM EVERY OTHER TOOL TABLE
-- -----------------------------------------------------------------------------
-- Every earlier tool table defaults `visibility` to 'org'. Here the default is
-- 'private', deliberately: a time entry is one person's hours, not org content.
-- The tool stamps visibility EXPLICITLY from its manifest on every insert; the
-- column default is the FAIL-SAFE half of that pair — if the write path ever
-- omits the value, the row must fail CLOSED (visible to its owner only), never
-- open to the whole tree. A defaults bug should hide a row, not publish it.
--
-- -----------------------------------------------------------------------------
-- THE SELECT POLICY IS auth_user_can_read — NOT THE OLDER 'org'-ONLY SHAPE
-- -----------------------------------------------------------------------------
-- notes/tasks/expenses/journal gate SELECT with
-- `is_member_of_tree(org_id) AND visibility = 'org'`. That shape CANNOT see
-- 'private' rows at all — on this table it would make every row invisible to
-- everyone, including its own owner, forever. So this table wires the SELECT
-- policy to `private.auth_user_can_read` (20260716000005, extended by
-- 20260723000003), exactly as inventory_items does: membership in the org tree
-- as a blocking AND, then 'org' by the tree, 'private' by the owner or a tree
-- admin, 'restricted' via record_grants.
--
-- -----------------------------------------------------------------------------
-- KNOWN ASYMMETRY: AN ORG ADMIN CAN READ AN ENTRY BUT NOT EDIT OR DELETE IT
-- -----------------------------------------------------------------------------
-- 20260723000003 widened `auth_user_can_read`'s private branch to admit an
-- admin of the row's org tree — and deliberately left `auth_user_can_write`
-- UNTOUCHED, so its private branch remains OWNER-ONLY. Since every write policy
-- below gates on can_write, the consequence on this table is: an org admin can
-- READ an employee's private time entries (via auth_user_is_admin_of_tree) but
-- CANNOT update or delete them. That asymmetry is INTENDED for now — review
-- means see, not rewrite someone's hours. If admin corrections are ever wanted,
-- that is a can_write change reviewed on its own, not a policy tweak here.
--
-- -----------------------------------------------------------------------------
-- IMMUTABILITY TRIGGER ATTACHED FROM BIRTH — NOT the tasks/notes/expenses gap
-- -----------------------------------------------------------------------------
-- 20260716000007's `enforce_tool_row_immutability` (visibility / org_id /
-- owner_id frozen after insert) is attached below — the SECOND attachment after
-- inventory_items, reusing the existing function exactly as its header
-- instructs ("attach to each tool table, do not copy"). The journal header
-- flagged the missing trigger as a known, narrow gap on 'org'-default tables;
-- on a born-private table the gap is not narrow: visibility and owner_id are
-- the ONLY things standing between one person's hours and the whole tree, so
-- they are load-bearing, not cosmetic, and are frozen from day one.
--
-- MEMBERSHIP IN THE ORG TREE IS THE GATE. THERE IS NO ACTION-LEVEL PERMISSION.
-- Same decision as every tool table since inventory (20260717000005's header):
-- no `auth_user_has_permission` is composed in, because the manifest's
-- permission keys do not exist in public.permissions — wiring one would invent
-- an ungrantable key and lock every member out. A real permission composes on
-- top later without loosening anything here.
--
-- NOTE LENGTH CAP: no earlier tool table carries a text length CHECK (only
-- 20260610000002's core tables do), so there is no tool precedent to mirror
-- literally. The cap below reuses that migration's style and its 4000-char
-- message limit; the non-whitespace half is omitted because `note` is
-- legitimately '' by default.
--
-- Does NOT touch anon or service_role. Does NOT touch any other table.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The table — org-scoped, visibility-bearing, BORN 'private'.
-- -----------------------------------------------------------------------------
create table public.time_entries (
  id       uuid primary key default gen_random_uuid(),

  -- Isolation is org-only. Tabs/branches are CHILD ORGS, not instances.
  owner_id uuid not null references public.users (id),
  org_id   uuid not null references public.organizations (id) on delete cascade,

  visibility text not null default 'private'
    check (visibility in ('private', 'org', 'restricted')),

  work_date  date not null default current_date,
  hours      numeric not null
    check (hours > 0 and hours <= 24),
  note       text not null default ''
    check (char_length(note) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table  public.time_entries            is 'Cortex Time-entries tool table. Org-scoped: reads key on org_id and inherit DOWN the org tree. Seventh tool table — the FIRST born ''private'': rows default to owner-only visibility, read via auth_user_can_read (owner or a tree admin), written via can_write (owner only).';
comment on column public.time_entries.owner_id   is 'The user who created/owns the row. On this table it IS the read/write key for the default ''private'' visibility — and it is frozen after insert by the immutability trigger.';
comment on column public.time_entries.org_id     is 'Owning organization. NEVER NULL: personal data lives in the user''s personal org.';
comment on column public.time_entries.visibility is 'Intended audience — defaults to ''private'', DELIBERATELY unlike every other tool table: the tool stamps visibility explicitly from its manifest, and this default is the fail-safe half. If the write path ever omits the value, the row fails CLOSED (owner-only), never open to the tree.';
comment on column public.time_entries.hours      is 'Hours worked on work_date. Bounded (0, 24] — a zero or negative entry is a mistake, and no day has more than 24.';

create index time_entries_org_id_idx   on public.time_entries (org_id);
create index time_entries_owner_id_idx on public.time_entries (owner_id);
-- The per-person listing ("my entries, by day") reads owner + date together.
create index time_entries_owner_id_work_date_idx on public.time_entries (owner_id, work_date);

-- -----------------------------------------------------------------------------
-- 2. RLS — SELECT via auth_user_can_read (NOT the 'org'-only shape; see the
--    header — that shape cannot see 'private' rows at all) + the write path.
-- -----------------------------------------------------------------------------
alter table public.time_entries enable row level security;

grant select on public.time_entries to authenticated;

create policy "read time entries the user is entitled to"
  on public.time_entries
  for select
  to authenticated
  using (
    private.auth_user_can_read('time_entries', id, org_id, owner_id, visibility)
  );

-- INSERT + UPDATE + DELETE, all gated by can_write (owner-only on 'private' —
-- the admin read path does NOT extend to writes; see the header).
grant insert, update, delete on public.time_entries to authenticated;

create policy "insert time entries you may write"
  on public.time_entries for insert to authenticated
  with check (
    private.auth_user_can_write('time_entries', id, org_id, owner_id, visibility)
    and owner_id = (select auth.uid())
  );

create policy "update time entries you may write"
  on public.time_entries for update to authenticated
  using      (private.auth_user_can_write('time_entries', id, org_id, owner_id, visibility))
  with check (private.auth_user_can_write('time_entries', id, org_id, owner_id, visibility));

create policy "delete time entries you may write"
  on public.time_entries for delete to authenticated
  using (private.auth_user_can_write('time_entries', id, org_id, owner_id, visibility));

-- -----------------------------------------------------------------------------
-- 3. Freeze visibility / org_id / owner_id — the EXISTING trigger function from
--    20260716000007, attached as its header instructs (no per-table copy). The
--    second attachment after inventory_items.
-- -----------------------------------------------------------------------------
create trigger time_entries_immutable_fields
  before update on public.time_entries
  for each row
  execute function private.enforce_tool_row_immutability();
