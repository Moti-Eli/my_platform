-- =============================================================================
-- Migration: Enable Row Level Security + Org-Membership Tenant Isolation (STEP 2)
-- =============================================================================
--
-- This migration turns on Row Level Security (RLS) for the core RBAC tables and
-- adds SELECT policies that enforce ONE rule:
--
--     A user may access a row only if they are a member of the organization
--     that row belongs to.
--
-- SCOPE — read this carefully:
--   * RLS here handles TENANT ISOLATION only: *which organization's* data a
--     user can see. It answers "is this row in one of my orgs?".
--   * RLS deliberately does NOT handle ACTION-LEVEL PERMISSIONS (who may invite
--     users, edit roles, etc.). That is the job of the permission system in
--     @platform/auth, layered on top later. Mixing the two here would couple
--     tenant isolation to business rules and make both harder to reason about.
--   * Only SELECT (read) policies are defined. We intentionally write NO
--     INSERT / UPDATE / DELETE policies yet. With RLS enabled, the absence of a
--     policy means the operation is DENIED for normal users. Writes stay locked
--     down until @platform/auth defines who may perform them. (The backend
--     using the Supabase *secret* key runs as `service_role`, which bypasses
--     RLS, so server-side seeding/admin operations continue to work.)
--
-- THE RECURSION FOOTGUN (the single most important technical point):
--   A naive policy on `memberships` such as
--       USING (organization_id IN (SELECT organization_id FROM memberships
--                                  WHERE user_id = auth.uid()))
--   causes INFINITE RECURSION: evaluating the policy runs a SELECT on
--   `memberships`, which must itself satisfy the same policy, which runs another
--   SELECT on `memberships`, forever. Postgres aborts with error 42P17.
--
--   The fix (current Supabase best practice): put the membership lookup inside a
--   SECURITY DEFINER function. Such a function executes with the privileges of
--   its OWNER (postgres), which BYPASSES RLS. So the lookup does not re-trigger
--   the calling table's policy, and the recursion is broken. We also:
--     - SET search_path = '' and fully schema-qualify every name, to close the
--       well-known SECURITY DEFINER search_path-hijack hole.
--     - Mark the functions STABLE so the planner can cache them within a query.
--     - Place them in a PRIVATE schema that is NOT exposed by PostgREST, so they
--       cannot be invoked directly as RPC endpoints.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Private schema for RLS helper functions.
-- -----------------------------------------------------------------------------
-- `private` is not in PostgREST's exposed schemas, so nothing in here is
-- reachable via the REST/RPC API. Only the `authenticated` role is granted the
-- ability to USE the schema (needed because RLS evaluates these functions in
-- the context of the querying user).
-- -----------------------------------------------------------------------------
create schema if not exists private;
grant usage on schema private to authenticated;

-- -----------------------------------------------------------------------------
-- Helper 1: auth_user_is_member_of(org_id) -> boolean
-- -----------------------------------------------------------------------------
-- True when the currently authenticated user (auth.uid()) has a membership row
-- in the given organization. This is the workhorse used by every org-scoped
-- table's policy.
--
-- SECURITY DEFINER + reading `memberships` is precisely what prevents the
-- recursion described above: when this runs inside the `memberships` SELECT
-- policy, it bypasses that policy instead of re-entering it.
-- -----------------------------------------------------------------------------
create or replace function private.auth_user_is_member_of(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organization_id = p_org_id
      and m.user_id = auth.uid()
  );
$$;

-- -----------------------------------------------------------------------------
-- Helper 2: auth_user_shares_org_with(user_id) -> boolean
-- -----------------------------------------------------------------------------
-- True when the authenticated user shares at least one organization with the
-- target user (i.e. both have a membership in the same org). Used by the
-- `users` policy so people can see co-members' profiles but not the whole user
-- table. SECURITY DEFINER again bypasses RLS on `memberships`.
-- -----------------------------------------------------------------------------
create or replace function private.auth_user_shares_org_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships me
    join public.memberships them
      on them.organization_id = me.organization_id
    where me.user_id = auth.uid()
      and them.user_id = p_user_id
  );
$$;

-- -----------------------------------------------------------------------------
-- Helper 3: auth_user_can_access_role(role_id) -> boolean
-- -----------------------------------------------------------------------------
-- True when the role belongs to an organization the authenticated user is a
-- member of. `role_permissions` has no organization_id column of its own, so it
-- resolves the role -> org -> membership chain here, entirely inside a
-- SECURITY DEFINER function (no reliance on, and no recursion through, the
-- `roles` or `memberships` policies).
-- -----------------------------------------------------------------------------
create or replace function private.auth_user_can_access_role(p_role_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.roles r
    join public.memberships m
      on m.organization_id = r.organization_id
    where r.id = p_role_id
      and m.user_id = auth.uid()
  );
$$;

-- Grant execute on the helpers to authenticated (anon is never granted schema
-- USAGE above, so anon cannot reach them).
grant execute on function private.auth_user_is_member_of(uuid)   to authenticated;
grant execute on function private.auth_user_shares_org_with(uuid) to authenticated;
grant execute on function private.auth_user_can_access_role(uuid) to authenticated;

-- =============================================================================
-- Enable RLS + SELECT policies, table by table.
-- =============================================================================
-- Note on grants: RLS filters ROWS but does not grant TABLE privileges. We
-- explicitly grant SELECT on each table to `authenticated` so that, combined
-- with the row policies below, authenticated users can read the rows they are
-- entitled to. `anon` is granted nothing and has no policy, so anon reads
-- nothing once RLS is on (this also closes the pre-RLS gap where the
-- publishable/anon key could read these tables).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- organizations — a user can read an org only if they are a member of it.
-- -----------------------------------------------------------------------------
alter table public.organizations enable row level security;
grant select on public.organizations to authenticated;

create policy "members can read their organizations"
  on public.organizations
  for select
  to authenticated
  using ( private.auth_user_is_member_of(id) );

-- -----------------------------------------------------------------------------
-- memberships — a user can read memberships of orgs they belong to (so they can
-- see their co-members), and can always read their own membership rows.
--
-- THIS IS THE TABLE THE RECURSION WARNING IS ABOUT. The policy is safe because
-- the org check goes through the SECURITY DEFINER helper, which bypasses this
-- very policy rather than re-evaluating it. The `user_id = (select auth.uid())`
-- branch touches no table at all.
-- -----------------------------------------------------------------------------
alter table public.memberships enable row level security;
grant select on public.memberships to authenticated;

create policy "members can read memberships in their organizations"
  on public.memberships
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or private.auth_user_is_member_of(organization_id)
  );

-- -----------------------------------------------------------------------------
-- users — a user can read their own row, plus rows of users who share at least
-- one organization with them. The global user list is never exposed.
-- -----------------------------------------------------------------------------
alter table public.users enable row level security;
grant select on public.users to authenticated;

create policy "users can read self and co-members"
  on public.users
  for select
  to authenticated
  using (
    id = (select auth.uid())
    or private.auth_user_shares_org_with(id)
  );

-- -----------------------------------------------------------------------------
-- roles — readable when the role's organization is one the user belongs to.
-- (Org-scoped via its own organization_id column.)
-- -----------------------------------------------------------------------------
alter table public.roles enable row level security;
grant select on public.roles to authenticated;

create policy "members can read roles in their organizations"
  on public.roles
  for select
  to authenticated
  using ( private.auth_user_is_member_of(organization_id) );

-- -----------------------------------------------------------------------------
-- role_permissions — readable when the PARENT role belongs to an org the user
-- is a member of. This table has no organization_id; the helper resolves the
-- role -> org -> membership chain (bypassing RLS) to avoid recursion.
-- -----------------------------------------------------------------------------
alter table public.role_permissions enable row level security;
grant select on public.role_permissions to authenticated;

create policy "members can read role_permissions in their organizations"
  on public.role_permissions
  for select
  to authenticated
  using ( private.auth_user_can_access_role(role_id) );

-- -----------------------------------------------------------------------------
-- membership_roles — readable when the row's organization is one the user
-- belongs to. (We added organization_id to this table in Step 1 precisely so
-- isolation could be expressed directly here.)
-- -----------------------------------------------------------------------------
alter table public.membership_roles enable row level security;
grant select on public.membership_roles to authenticated;

create policy "members can read membership_roles in their organizations"
  on public.membership_roles
  for select
  to authenticated
  using ( private.auth_user_is_member_of(organization_id) );

-- -----------------------------------------------------------------------------
-- permissions — GLOBAL, code-defined reference data (not org-scoped). Any
-- authenticated user may read the full catalog; nobody gets write policies, so
-- inserts/updates/deletes are denied for normal users (the catalog is managed
-- by us through migrations, which run as a privileged role that bypasses RLS).
-- -----------------------------------------------------------------------------
alter table public.permissions enable row level security;
grant select on public.permissions to authenticated;

create policy "authenticated can read the global permission catalog"
  on public.permissions
  for select
  to authenticated
  using ( true );

-- =============================================================================
-- WRITES ARE INTENTIONALLY UNPOLICIED (therefore DENIED) on every table above.
-- INSERT / UPDATE / DELETE for normal users will be added in a later migration
-- once @platform/auth defines the action-level permission checks. Until then,
-- all mutations must go through the server (service_role / secret key), which
-- bypasses RLS.
-- =============================================================================
