-- =============================================================================
-- Migration: record_grants — the shell's per-record access-grant table
-- =============================================================================
--
-- `20260716000002` left `inventory_items` rows marked 'private' or 'restricted'
-- readable by NOBODY through the client API, deliberately failing CLOSED until
-- "the record_grants table lands in a later migration and teaches the policy who
-- may see them". This is that table. It stores, per RECORD, who may do what.
--
-- It is DATA-ONLY: this migration adds the table, its constraints, and a
-- subject-validation trigger. It does NOT touch any existing table and does NOT
-- rewire the `inventory_items` policy — that stays fail-closed until a separate,
-- individually-reviewable migration teaches it to consult these grants. Adding
-- the store and widening access are two different reviews.
--
-- -----------------------------------------------------------------------------
-- SUBJECT SIDE — three real FKs, NOT a polymorphic (subject_type, subject_id)
-- -----------------------------------------------------------------------------
-- A grant's subject is a user, a role, or a group. We model that as THREE
-- nullable FK columns with a CHECK that exactly one is set, rather than the
-- tempting (subject_type text, subject_id uuid) pair.
--
-- The reason is deletion. A polymorphic subject_id can FK to nothing, so
-- deleting a role or a group would leave grant rows pointing at the dead — and a
-- SECURITY TABLE that accumulates dangling pointers is a liability: the id can be
-- reused, the row reads as a live grant to anyone auditing it, and nothing in the
-- schema can tell you it is stale. With real FKs, `on delete cascade` reaps the
-- grants the moment their subject disappears. Deleting a group deletes its
-- grants. That property is worth three columns.
--
-- This is the same reasoning that killed `app_instances.owner_id`'s polymorphism
-- in 20260716000002 ("a user id or an org id, depending on owner_type,
-- FK-constrained to nothing").
--
-- -----------------------------------------------------------------------------
-- OBJECT SIDE — (table_name, record_id) IS polymorphic, and must be
-- -----------------------------------------------------------------------------
-- The object side gets no such treatment, because it cannot: a foreign key must
-- name ONE referenced table, and this table's whole purpose is to grant on rows
-- in ANY tool table. That is inherent to flat ReBAC — you cannot FK to "whatever
-- table the caller names". So (table_name, record_id) is an untyped pointer, and
-- the integrity a FK would have given us is not available here:
--   * deleting a tool row does NOT reap its grants (no cascade to hang it on);
--   * nothing stops a row naming a table that does not exist.
-- Both are accepted costs of the flat model. The mitigation is that a grant is
-- INERT on its own — every read path ANDs org-tree membership first — so a stale
-- grant grants nothing; it is only rot, not a hole.
--
-- -----------------------------------------------------------------------------
-- org_id IS DENORMALIZED FROM THE GRANTED ROW — and why that is honest
-- -----------------------------------------------------------------------------
-- `org_id` duplicates the owning org of the row identified by (table_name,
-- record_id). It is REQUIRED, not a convenience: because `table_name` is dynamic,
-- NOTHING can look up that row's org without dynamic SQL — not a CHECK, not a
-- generated column, not an RLS policy. Carrying the org here is what lets the
-- lookup index and every future policy stay static SQL.
--
-- A denormalized copy is only as good as its invariant. The one that keeps this
-- honest: a LATER migration adds a trigger BLOCKING changes to a tool row's
-- `org_id`. Once a row's org is immutable, a copy taken at grant time can never
-- drift from it, and the duplication becomes a cache of a constant rather than a
-- second source of truth that can disagree with the first. Until that trigger
-- lands, this column is trusted because Cortex writes are `service_role`-only and
-- no code path moves a row between orgs.
--
-- -----------------------------------------------------------------------------
-- RLS — ENABLED, WITH NO POLICIES, AND NOTHING GRANTED TO CLIENTS
-- -----------------------------------------------------------------------------
-- This table is INVISIBLE to clients by design. Not "read-only to members" —
-- invisible.
--
-- The grant rows are themselves sensitive, independently of the records they
-- point at. A grant row on a sensitive table leaks that the record EXISTS, which
-- table it lives in, and WHO can see it — the shape of an investigation, an HR
-- case, or a deal, readable straight off the access-control metadata even by
-- someone who can't open a single one of the records. The membership graph is not
-- something a member is entitled to enumerate.
--
-- So: RLS is ON with NO policies (no policy = deny), and `revoke all` strips even
-- the default non-DML grants — the same sealing as `platform_admins`
-- (20260609000001). Reads happen ONLY inside SECURITY DEFINER helpers, which
-- bypass RLS and return a BOOLEAN ABOUT THE CALLER rather than the grant list,
-- and server-side as `service_role`. A future `can_read` helper is the only thing
-- that should ever read this table on a client's behalf.
--
-- DO NOT add a client SELECT policy to this table without a separate security
-- review. "Let a user see grants naming them" is exactly the leak described
-- above, one join away.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. record_grants — one row per (record, subject) grant.
-- -----------------------------------------------------------------------------
create table public.record_grants (
  id uuid primary key default gen_random_uuid(),

  -- OBJECT: the polymorphic pointer. No FK is possible — see the header.
  table_name text not null,
  record_id  uuid not null,

  -- Denormalized owning org of the granted row. See the header.
  org_id uuid not null references public.organizations (id) on delete cascade,

  -- SUBJECT: exactly one of these three is set (enforced below). Real FKs, so a
  -- deleted user/role/group takes its grants with it.
  subject_user_id  uuid references public.users (id)  on delete cascade,
  subject_role_id  uuid references public.roles (id)  on delete cascade,
  subject_group_id uuid references public.groups (id) on delete cascade,

  access text not null check (access in ('read', 'write', 'grant')),

  -- Audit: who issued this grant. ON DELETE behavior deliberately mirrors
  -- `inventory_items.owner_id` (20260716000002) — a plain reference with NO
  -- delete action, i.e. NO ACTION: deleting a user who still has grants to their
  -- name is REJECTED rather than silently rewriting or erasing the audit trail.
  -- The user must be dealt with explicitly, exactly as for a row they own.
  granted_by uuid not null references public.users (id),

  created_at timestamptz not null default now(),

  -- EXACTLY ONE SUBJECT. Written as a sum of non-null flags rather than a chain
  -- of ORs: the sum states the rule once ("how many subjects are set? one"),
  -- while the OR form spells out each of the legal combinations separately and
  -- has to be re-read in full to confirm it still means what it claims.
  constraint record_grants_exactly_one_subject check (
    (subject_user_id  is not null)::int
    + (subject_role_id  is not null)::int
    + (subject_group_id is not null)::int
    = 1
  )
);

comment on table  public.record_grants                  is 'Per-record access grants (flat ReBAC). SEALED: RLS on with no policies and no client grants — a grant row leaks that a record exists and who can see it. Read only via SECURITY DEFINER helpers / service_role.';
comment on column public.record_grants.table_name       is 'Which tool table the granted row lives in. Polymorphic and unenforceable — a FK must name one table. See the migration header.';
comment on column public.record_grants.record_id        is 'The granted row''s id, within table_name. Not FK-enforced; a stale grant is inert (reads AND org-tree membership first).';
comment on column public.record_grants.org_id           is 'Owning org of the granted row, DENORMALIZED. Required: table_name is dynamic, so nothing can resolve the row''s org without dynamic SQL. Kept honest by the (later) trigger making a tool row''s org_id immutable.';
comment on column public.record_grants.subject_user_id  is 'Grantee, when the subject is a single user. Exactly one subject column is non-null.';
comment on column public.record_grants.subject_role_id  is 'Grantee, when the subject is a role (may be a role of an ANCESTOR org — that is the point of the tree).';
comment on column public.record_grants.subject_group_id is 'Grantee, when the subject is a group.';
comment on column public.record_grants.access           is 'Access level conferred: ''read'' < ''write'' < ''grant'' (''grant'' = may re-grant). Changing a level is an UPDATE of this column, never a second row.';
comment on column public.record_grants.granted_by       is 'The user who issued this grant (audit). NO ACTION on delete, mirroring inventory_items.owner_id — deleting a granting user is rejected, not silently erased.';

-- -----------------------------------------------------------------------------
-- 2. Uniqueness — one grant per (record, subject). THREE PARTIAL indexes.
-- -----------------------------------------------------------------------------
-- A single `unique (table_name, record_id, subject_user_id, subject_role_id,
-- subject_group_id)` would NOT dedupe anything. Two grants to the same user carry
-- NULL in both the role and group columns, and Postgres treats NULLs as DISTINCT
-- in a unique index by default — so every such pair compares as "different" and
-- the constraint never fires. The rule silently does nothing, which is the worst
-- failure mode a constraint has.
--
-- `NULLS NOT DISTINCT` (PG15+) would technically fix that, and we deliberately do
-- NOT lean on it: it inverts the default meaning of a unique index at a distance,
-- so a reader who misses those two words reads the constraint backwards. Three
-- partial indexes say the same thing in the obvious way — each one indexes only
-- the rows with that subject kind, over columns that are all non-null in it — and
-- each is directly useful as a lookup index for its subject kind.
--
-- They cannot collide with one another: any given row appears in exactly ONE of
-- the three (the CHECK above guarantees exactly one subject is non-null), so the
-- SAME (table_name, record_id) can be granted to a user AND a role AND a group.
--
-- Changing someone's access level is an UPDATE of `access`, NOT a second row —
-- these indexes are what force that. Two rows granting the same subject different
-- levels on one record would make "what access does X have?" ambiguous.
-- -----------------------------------------------------------------------------
create unique index record_grants_user_subject_unique
  on public.record_grants (table_name, record_id, subject_user_id)
  where subject_user_id is not null;

create unique index record_grants_role_subject_unique
  on public.record_grants (table_name, record_id, subject_role_id)
  where subject_role_id is not null;

create unique index record_grants_group_subject_unique
  on public.record_grants (table_name, record_id, subject_group_id)
  where subject_group_id is not null;

-- -----------------------------------------------------------------------------
-- 3. Lookup index — the question every read path asks.
-- -----------------------------------------------------------------------------
-- "Which grants exist on THIS row, in THIS org?" — the access check's hot path.
-- org_id is included so the membership-scoped lookup stays index-only.
create index record_grants_lookup_idx
  on public.record_grants (table_name, record_id, org_id);

-- FK covering indexes: without these, deleting a user/role/group seq-scans this
-- table to service the cascade. (granted_by is NO ACTION, but its check on user
-- delete needs the same help.)
create index record_grants_subject_user_id_idx  on public.record_grants (subject_user_id);
create index record_grants_subject_role_id_idx  on public.record_grants (subject_role_id);
create index record_grants_subject_group_id_idx on public.record_grants (subject_group_id);
create index record_grants_granted_by_idx       on public.record_grants (granted_by);
create index record_grants_org_id_idx           on public.record_grants (org_id);

-- -----------------------------------------------------------------------------
-- 4. Seal the table to client roles. RLS on, NO policies, nothing granted.
-- -----------------------------------------------------------------------------
alter table public.record_grants enable row level security;

-- Defense in depth, as on platform_admins: strip even the default non-DML grants
-- so the publishable/anon key has no privilege of any kind here.
revoke all on public.record_grants from anon, authenticated;

-- service_role (secret key, server-side only) manages grants. It also receives
-- this via the public-schema default privileges; granted explicitly so this
-- table's intent is self-contained and review-local.
grant all privileges on public.record_grants to service_role;

-- NOTE: there are intentionally NO policies here. See the header before adding one.

-- -----------------------------------------------------------------------------
-- 5. Trigger: the subject must live in the granted row's ORG TREE.
-- -----------------------------------------------------------------------------
-- Rejects a grant whose subject belongs to an organization that has no business
-- being named on this row:
--   * subject_role_id  -> the role's organization_id must be in the chain
--   * subject_group_id -> the group's org_id must be in the chain
--   * subject_user_id  -> the user must have an ACTIVE membership in some org in
--                         the chain
-- where CHAIN = the granted row's org PLUS all of its ancestors (active only,
-- depth-capped at 32) — the same set `private.auth_user_is_member_of_tree` walks,
-- built here ONCE per statement and reused for whichever subject is set.
--
-- WHY THE CHAIN AND NOT EQUALITY (subject org = row org):
--   Granting to a PARENT org's role is THE central case the tree exists for. An
--   HQ role must be grantable on a branch's restricted row — that is what
--   "inheritance flows downward" means when applied to grants. Equality would
--   forbid exactly that, which would reduce the org tree to decoration. The chain
--   is what makes the parent-role grant expressible; it also naturally REJECTS a
--   CHILD org's role (a child is not an ancestor), so no upward leak sneaks in
--   through the grant table.
--
-- WHY VALIDATE AT ALL — a foreign-org grant is already INERT, since every read
-- path ANDs org-tree membership before ever consulting a grant, so a grant naming
-- a stranger confers nothing. We validate anyway because an inert grant is ROT IN
-- A SECURITY TABLE: it reads as live to anyone auditing the table, it survives
-- until someone proves it meaningless, and it means the table's contents can no
-- longer be trusted to describe reality. The read path failing closed is not a
-- reason to let the write path store nonsense.
--
-- CONSEQUENCE — MEMBERSHIP MUST PRECEDE THE GRANT. You cannot pre-grant to a user
-- who has not been added to the org yet; the insert is rejected. Onboarding is
-- therefore ordered: create the membership, then grant. This also means a grant
-- to a user whose membership is SOFT-DELETED is rejected (the walk counts only
-- active memberships), so re-granting to an offboarded user forces you to
-- reinstate them first rather than quietly routing around the offboarding.
--
-- SECURITY DEFINER: the walk must see the TRUE hierarchy and the TRUE membership
-- rows, not the caller's RLS-filtered view of them — same reasoning as
-- `private.enforce_org_parent_no_cycle`. `set search_path = ''` with fully
-- qualified names, matching our other private helpers.
-- -----------------------------------------------------------------------------
create or replace function private.enforce_record_grant_subject_in_tree()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chain uuid[];
  v_ok    boolean;
begin
  -- The granted row's org plus its ancestors, active-only, depth-capped at 32.
  -- Mirrors the CTE in private.auth_user_is_member_of_tree: a soft-deleted org is
  -- not in the chain, so it is neither matched nor walked THROUGH.
  with recursive chain as (
    select o.id, o.parent_id, 1 as depth
    from public.organizations o
    where o.id = new.org_id
      and o.deleted_at is null
    union all
    select p.id, p.parent_id, c.depth + 1
    from chain c
    join public.organizations p on p.id = c.parent_id
    where c.depth < 32
      and p.deleted_at is null
  )
  select array_agg(c.id) into v_chain from chain c;

  -- Empty chain => the row's own org is soft-deleted (or vanished mid-statement).
  -- Nothing can be validly granted inside a dead org.
  if v_chain is null then
    raise exception 'Cannot grant on a record in organization % — the organization is not active', new.org_id
      using errcode = 'check_violation',
            hint = 'Restore the organization before granting on its records.';
  end if;

  if new.subject_role_id is not null then
    select exists (
      select 1
      from public.roles r
      where r.id = new.subject_role_id
        and r.organization_id = any (v_chain)
    ) into v_ok;

    if not v_ok then
      raise exception 'Role % is not in the org tree of organization %', new.subject_role_id, new.org_id
        using errcode = 'check_violation',
              hint = 'A grant''s role must belong to the record''s org or one of its ANCESTORS. A child org''s role is not eligible — inheritance flows downward only.';
    end if;

  elsif new.subject_group_id is not null then
    select exists (
      select 1
      from public.groups g
      where g.id = new.subject_group_id
        and g.org_id = any (v_chain)
    ) into v_ok;

    if not v_ok then
      raise exception 'Group % is not in the org tree of organization %', new.subject_group_id, new.org_id
        using errcode = 'check_violation',
              hint = 'A grant''s group must belong to the record''s org or one of its ANCESTORS.';
    end if;

  elsif new.subject_user_id is not null then
    -- The chain holds only ACTIVE orgs, so an active membership in any of them
    -- means the user really can reach this record's org tree today.
    select exists (
      select 1
      from public.memberships m
      where m.user_id = new.subject_user_id
        and m.organization_id = any (v_chain)
        and m.deleted_at is null
    ) into v_ok;

    if not v_ok then
      raise exception 'User % has no active membership in the org tree of organization %', new.subject_user_id, new.org_id
        using errcode = 'check_violation',
              hint = 'Membership must precede the grant: add the user to the record''s org (or an ancestor) first. A soft-deleted membership does not count.';
    end if;
  end if;

  -- No else: "exactly one subject" is the CHECK constraint's job, and it is
  -- evaluated after this BEFORE trigger regardless of what we do here.
  return new;
end;
$$;

comment on function private.enforce_record_grant_subject_in_tree() is 'BEFORE INSERT/UPDATE guard on record_grants: the subject (role/group/user) must belong to the granted row''s org or one of its ANCESTORS. Ancestor chain is active-only, depth-capped at 32. Rejects foreign-org and child-org subjects so the security table cannot accumulate inert grants.';

-- Trigger function is invoked by the trigger, never called directly.
revoke all on function private.enforce_record_grant_subject_in_tree() from public;

create trigger record_grants_subject_in_tree
  before insert or update on public.record_grants
  for each row
  execute function private.enforce_record_grant_subject_in_tree();
