-- =============================================================================
-- Migration: shell.grant_access / shell.revoke_access — the door to record_grants
-- =============================================================================
--
-- `record_grants` (20260716000004) is SEALED: RLS on, zero policies, zero client
-- grants. Nothing outside the server can read or write it. That seal is what makes
-- these two functions THE ONLY DOOR through which a human ever changes a grant —
-- and a door is only a door if it checks who is knocking. Every path through both
-- functions runs `private.auth_user_can_grant` before touching a row. There is no
-- branch that skips it.
--
-- -----------------------------------------------------------------------------
-- THE `shell` SCHEMA IS NOT EXPOSED TO PostgREST
-- -----------------------------------------------------------------------------
-- We create the schema and grant USAGE to authenticated/service_role, but we do
-- NOT add it to PostgREST's exposed schemas. Whether the door is reached by a
-- client RPC or only from a server route is a STEP 7 decision — it depends on the
-- creation path that does not exist yet. This migration builds the door; where the
-- door is mounted comes later. Note that `authenticated` gets USAGE + EXECUTE here
-- anyway, so mounting it later is a config change and not a rewrite; until then the
-- functions are reachable only from server-side code and from SQL.
--
-- -----------------------------------------------------------------------------
-- p_table_name IS VALIDATED BY SHAPE, NOT AGAINST AN ALLOWLIST
-- -----------------------------------------------------------------------------
-- A `grantable_tables` list would be a SECOND SOURCE OF TRUTH that has to be
-- updated in lockstep with every tool migration — exactly the parallel-list
-- pattern this repo has been burned by three times, and the one the roadmap's
-- first standing rule exists to prevent. Forget the list once and a real tool
-- table is silently ungrantable (or worse, a removed one stays grantable).
--
-- So GRANTABLE IS A SHAPE, not a membership: a base table in schema `public`
-- carrying all three of `org_id`, `owner_id`, `visibility` — the columns the
-- access model is computed from. A table that has them IS a tool table; a table
-- that lacks them cannot participate in the model at all. This falls out
-- correctly with no list to maintain:
--   * `app_instances` is excluded automatically — it is a shell table with no
--     `visibility` column (the same reason 20260716000007 does not attach the
--     immutability trigger to it).
--   * `record_grants` itself is excluded — no visibility column. You cannot grant
--     on the grant table.
--   * Anything outside `public` (pg_catalog, auth, private) is excluded by schema.
--   * A NEW tool table becomes grantable by BEING SHAPED LIKE ONE. No migration
--     to this file, nothing to forget.
-- We query pg_catalog (pg_class / pg_attribute / pg_namespace) rather than
-- information_schema: information_schema only shows objects the CALLER has
-- privileges on, which would make the answer depend on who is asking — wrong for
-- a SECURITY DEFINER shape check that must be objective.
--
-- -----------------------------------------------------------------------------
-- DYNAMIC SQL — WHY IT IS SAFE HERE
-- -----------------------------------------------------------------------------
-- Reading the row's org/owner/visibility REQUIRES dynamic SQL: `table_name` is a
-- runtime value, which is the same reason `record_grants.org_id` is denormalized
-- in the first place (nothing static can resolve a row from a dynamic table name).
-- Two things make it safe, and BOTH are needed:
--   1. `format(..., %I)` quotes the identifier — a value containing a quote or a
--      semicolon becomes a quoted identifier, never syntax.
--   2. The shape check (c) has ALREADY PROVEN the identifier names a real, correctly
--      shaped base table in `public`. So by the time we interpolate, the string is
--      not merely escaped, it is known-good.
-- The record_id is passed as a bind parameter (`using`), never interpolated. An
-- injection attempt does not reach step (d) at all: it dies at (c) with "not a
-- grantable table", because no such relation exists.
--
-- The read in (d) additionally assumes an `id` column. Every tool table has one
-- (`id uuid primary key`); a shaped table without one fails loudly at the first
-- call, which is the same fail-loud stance 20260716000007 takes.
--
-- -----------------------------------------------------------------------------
-- auth.uid() STILL RESOLVES INSIDE SECURITY DEFINER — AND THAT IS THE POINT
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER changes which PRIVILEGES the body runs with; it does NOT change
-- the request context. `auth.uid()` reads the request JWT claims, so it still
-- reports the CALLER, not the owner. That is what lets the door run as an
-- RLS-bypassing owner (it must, to write a sealed table) while still proving who
-- is asking.
--
-- A caller with NO JWT context — including a direct `service_role` connection —
-- gets `auth.uid() = null`, so `auth_user_is_member_of_tree` matches no membership,
-- `can_grant` returns false, and the door RAISES. The door fails closed by
-- construction: "I am service_role" is not an identity, and this function will not
-- act for someone who cannot say who they are.
--
-- -----------------------------------------------------------------------------
-- THE PARTIAL INDEXES FORCE ONE ON CONFLICT PER SUBJECT BRANCH
-- -----------------------------------------------------------------------------
-- record_grants' uniqueness is THREE PARTIAL unique indexes (one per subject
-- kind), each with a `WHERE <col> IS NOT NULL` predicate. An ON CONFLICT arbiter
-- can only be inferred by matching BOTH the index's columns AND its predicate, so
-- there is no single generic ON CONFLICT that covers all three — the upsert MUST
-- branch in plpgsql, one arm per subject, each restating its index's WHERE clause.
-- That is why this reads as three near-identical blocks. It is not duplication that
-- can be factored away; it is the shape the partial indexes require.
--
-- Re-granting the same (row, subject) at a different level therefore UPDATES the
-- existing row and never inserts a second one — the invariant record_grants'
-- header demands ("changing an access level is an UPDATE, not a second row").
-- `granted_by` is updated too: it records who set the CURRENT level, and leaving
-- the original granter there would make it name someone who did not make this
-- decision.
--
-- `org_id` on the new grant is ALWAYS the row's own org, read in (d). It is never a
-- parameter — the caller must not be able to state it, or the denormalized copy
-- record_grants relies on would be caller-controlled and could be made to lie.
--
-- -----------------------------------------------------------------------------
-- WHY revoke_access EXISTS
-- -----------------------------------------------------------------------------
-- A door that only opens is half a door. Without revoke, the only way to remove a
-- grant is direct DML on a sealed table — which means either handing someone the
-- service key or adding a bypass, and either way the door stops being the only
-- way in. Revoking requires `can_grant` exactly as granting does: the power to
-- widen access and the power to withdraw it are the same power.
--
-- Revoking something that is not there returns FALSE and does not raise. It is not
-- an error to ask for a state that already holds — the caller wanted the grant
-- gone, and it is gone. Raising would make idempotent cleanup impossible.
--
-- -----------------------------------------------------------------------------
-- service_role KEEPS ITS DIRECT DML ON record_grants — DELIBERATE
-- -----------------------------------------------------------------------------
-- 20260608000002 grants service_role full DML on public, record_grants included,
-- and this migration does NOT revoke it. That is a decision, not an oversight:
--
--   The FIRST grant on a restricted row is chicken-and-egg. `can_grant` requires an
--   existing 'grant'-level grant, so NOBODY can open a freshly created restricted
--   row from outside — by design (see 20260716000006's header). The shell writes
--   that first grant as service_role, directly, from the manifest's defaultGrants
--   at creation time. Revoking service_role's DML would either break that bootstrap
--   or force us to add a system function that skips can_grant — which is precisely
--   a back door, and a back door with a name is still a back door.
--
-- The door protects against TOOLS and CLIENTS, and they cannot reach record_grants
-- at all: it is sealed (RLS on, zero policies, zero client grants), so for every
-- caller that is not the server, these two functions are already the only way in.
-- Locking service_role itself down belongs with the creation path, in step 7, where
-- defaultGrants gets written and the bootstrap has somewhere principled to live.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The `shell` schema.
-- -----------------------------------------------------------------------------
create schema if not exists shell;

comment on schema shell is 'Server-side entry points for Cortex shell operations. NOT exposed to PostgREST (mounting it is a step-7 decision). Functions here are SECURITY DEFINER doors onto sealed tables and always re-check the caller''s permission.';

grant usage on schema shell to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. shell.grant_access(...) -> uuid (the new/updated grant's id)
-- -----------------------------------------------------------------------------
create or replace function shell.grant_access(
  p_table_name       text,
  p_record_id        uuid,
  p_access           text,
  p_subject_user_id  uuid default null,
  p_subject_role_id  uuid default null,
  p_subject_group_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id     uuid;
  v_owner_id   uuid;
  v_visibility text;
  v_found      int;
  v_grant_id   uuid;
begin
  -- (a) EXACTLY ONE SUBJECT. Same numeric-sum form as record_grants' CHECK: it
  --     states the rule once instead of enumerating the legal combinations.
  if ( (p_subject_user_id  is not null)::int
     + (p_subject_role_id  is not null)::int
     + (p_subject_group_id is not null)::int ) <> 1 then
    raise exception 'exactly one subject must be given (user, role, or group)'
      using errcode = 'check_violation',
            hint = 'Pass exactly one of p_subject_user_id / p_subject_role_id / p_subject_group_id.';
  end if;

  -- (b) ACCESS VOCABULARY. Checked here as well as by the table's CHECK so the
  --     door gives a readable error instead of a constraint violation.
  if p_access is null or p_access not in ('read', 'write', 'grant') then
    raise exception 'invalid access level: %', coalesce(p_access, '<null>')
      using errcode = 'check_violation',
            hint = 'access must be one of ''read'', ''write'', ''grant''.';
  end if;

  -- (c) GRANTABLE IS A SHAPE, NOT A LIST. A base table in `public` with all three
  --     access-model columns. pg_catalog, not information_schema (which would
  --     filter by the caller's privileges and make the answer subjective).
  if not exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = p_table_name
      and c.relkind = 'r'
      and (
        select count(*)
        from pg_catalog.pg_attribute a
        where a.attrelid = c.oid
          and not a.attisdropped
          and a.attnum > 0
          and a.attname in ('org_id', 'owner_id', 'visibility')
      ) = 3
  ) then
    raise exception 'not a grantable table: %', p_table_name
      using errcode = 'check_violation',
            hint = 'A grantable table is a base table in schema public with org_id, owner_id and visibility columns.';
  end if;

  -- (d) Read the row. %I quotes the identifier; (c) already proved it names a real
  --     shaped table. record_id is a bind parameter, never interpolated.
  execute format('select org_id, owner_id, visibility from public.%I where id = $1', p_table_name)
    into v_org_id, v_owner_id, v_visibility
    using p_record_id;
  get diagnostics v_found = row_count;

  if v_found = 0 then
    raise exception 'record not found: %.%', p_table_name, p_record_id
      using errcode = 'no_data_found';
  end if;

  -- (e) THE WHOLE POINT OF THE DOOR. Never skipped, for any caller. auth.uid()
  --     reports the CALLER even here (SECURITY DEFINER changes privileges, not
  --     request context), so no JWT => auth.uid() null => can_grant false => raise.
  if not private.auth_user_can_grant(p_table_name, p_record_id, v_org_id, v_owner_id, v_visibility) then
    raise exception 'not permitted to grant on this record'
      using errcode = 'insufficient_privilege',
            hint = 'Granting requires an existing ''grant''-level grant on this record, and the record must be visibility=''restricted''.';
  end if;

  -- (f) Upsert. One arm per subject: the unique indexes are PARTIAL, so each
  --     arbiter must restate its index's WHERE predicate. org_id is the ROW's org
  --     (never a parameter); granted_by is the caller, on insert AND on update.
  if p_subject_user_id is not null then
    insert into public.record_grants (table_name, record_id, org_id, subject_user_id, access, granted_by)
    values (p_table_name, p_record_id, v_org_id, p_subject_user_id, p_access, auth.uid())
    on conflict (table_name, record_id, subject_user_id) where subject_user_id is not null
    do update set access = excluded.access, granted_by = excluded.granted_by
    returning id into v_grant_id;

  elsif p_subject_role_id is not null then
    insert into public.record_grants (table_name, record_id, org_id, subject_role_id, access, granted_by)
    values (p_table_name, p_record_id, v_org_id, p_subject_role_id, p_access, auth.uid())
    on conflict (table_name, record_id, subject_role_id) where subject_role_id is not null
    do update set access = excluded.access, granted_by = excluded.granted_by
    returning id into v_grant_id;

  else
    insert into public.record_grants (table_name, record_id, org_id, subject_group_id, access, granted_by)
    values (p_table_name, p_record_id, v_org_id, p_subject_group_id, p_access, auth.uid())
    on conflict (table_name, record_id, subject_group_id) where subject_group_id is not null
    do update set access = excluded.access, granted_by = excluded.granted_by
    returning id into v_grant_id;
  end if;

  -- NOTE: record_grants' subject-in-tree trigger (20260716000004) fires on that
  -- insert and is NOT bypassed by this function. Granting to a subject outside the
  -- record's org tree raises from in here, exactly as it would from outside.
  return v_grant_id;
end;
$$;

comment on function shell.grant_access(text, uuid, text, uuid, uuid, uuid) is 'The door onto record_grants: validates the subject/access/table shape, reads the row, requires private.auth_user_can_grant for the CALLER (auth.uid() resolves inside SECURITY DEFINER, so no JWT => refused), then upserts the grant. org_id is always the row''s own org, never a parameter. Re-granting updates the level rather than adding a row.';

revoke all on function shell.grant_access(text, uuid, text, uuid, uuid, uuid) from public;
grant execute on function shell.grant_access(text, uuid, text, uuid, uuid, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. shell.revoke_access(...) -> boolean (true if a grant was removed)
-- -----------------------------------------------------------------------------
create or replace function shell.revoke_access(
  p_table_name       text,
  p_record_id        uuid,
  p_subject_user_id  uuid default null,
  p_subject_role_id  uuid default null,
  p_subject_group_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id     uuid;
  v_owner_id   uuid;
  v_visibility text;
  v_found      int;
  v_deleted    int;
begin
  -- (a) Exactly one subject.
  if ( (p_subject_user_id  is not null)::int
     + (p_subject_role_id  is not null)::int
     + (p_subject_group_id is not null)::int ) <> 1 then
    raise exception 'exactly one subject must be given (user, role, or group)'
      using errcode = 'check_violation',
            hint = 'Pass exactly one of p_subject_user_id / p_subject_role_id / p_subject_group_id.';
  end if;

  -- (c) Grantable is a shape. Same check as grant_access.
  if not exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = p_table_name
      and c.relkind = 'r'
      and (
        select count(*)
        from pg_catalog.pg_attribute a
        where a.attrelid = c.oid
          and not a.attisdropped
          and a.attnum > 0
          and a.attname in ('org_id', 'owner_id', 'visibility')
      ) = 3
  ) then
    raise exception 'not a grantable table: %', p_table_name
      using errcode = 'check_violation',
            hint = 'A grantable table is a base table in schema public with org_id, owner_id and visibility columns.';
  end if;

  -- (d) Read the row.
  execute format('select org_id, owner_id, visibility from public.%I where id = $1', p_table_name)
    into v_org_id, v_owner_id, v_visibility
    using p_record_id;
  get diagnostics v_found = row_count;

  if v_found = 0 then
    raise exception 'record not found: %.%', p_table_name, p_record_id
      using errcode = 'no_data_found';
  end if;

  -- (e) Withdrawing access is the same power as widening it. Same check.
  if not private.auth_user_can_grant(p_table_name, p_record_id, v_org_id, v_owner_id, v_visibility) then
    raise exception 'not permitted to revoke on this record'
      using errcode = 'insufficient_privilege',
            hint = 'Revoking requires an existing ''grant''-level grant on this record.';
  end if;

  if p_subject_user_id is not null then
    delete from public.record_grants rg
    where rg.table_name = p_table_name
      and rg.record_id = p_record_id
      and rg.subject_user_id = p_subject_user_id;

  elsif p_subject_role_id is not null then
    delete from public.record_grants rg
    where rg.table_name = p_table_name
      and rg.record_id = p_record_id
      and rg.subject_role_id = p_subject_role_id;

  else
    delete from public.record_grants rg
    where rg.table_name = p_table_name
      and rg.record_id = p_record_id
      and rg.subject_group_id = p_subject_group_id;
  end if;

  get diagnostics v_deleted = row_count;

  -- Nothing to revoke is NOT an error: the caller wanted the grant gone, and it is
  -- gone. Raising here would make idempotent cleanup impossible.
  return v_deleted > 0;
end;
$$;

comment on function shell.revoke_access(text, uuid, uuid, uuid, uuid) is 'The other half of the door: removes a grant, requiring private.auth_user_can_grant for the CALLER exactly as granting does (widening and withdrawing access are the same power). Returns true if a grant was removed, false if there was nothing to revoke — absence is not an error.';

revoke all on function shell.revoke_access(text, uuid, uuid, uuid, uuid) from public;
grant execute on function shell.revoke_access(text, uuid, uuid, uuid, uuid) to authenticated, service_role;
