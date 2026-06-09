-- =============================================================================
-- Migration: Platform-Owner (Super Admin) layer
-- =============================================================================
--
-- Introduces an access level ABOVE organization admins: the PLATFORM OWNER (the
-- operator of the whole platform). A platform owner onboards new clients by
-- creating a new organization and its first admin. This is the most
-- security-sensitive construct in the system because it sits ABOVE tenant
-- isolation, so it is built to be (a) explicit, (b) auditable, and (c)
-- impossible for a normal user to grant themselves.
--
-- DESIGN — why a dedicated table (not a boolean on `users`):
--   * Explicit & auditable: each grant is its own row with a timestamp and an
--     optional note (who/why). Easy to list owners, easy to revoke (delete row).
--   * Minimal, deny-by-default attack surface: the ENTIRE table is locked to
--     client roles (see RLS + REVOKE below). A boolean column on `public.users`
--     would share that table's read surface and would need fragile
--     column-level rules to keep it non-writable; a separate table is simpler to
--     prove safe.
--   * Tied to the real identity: PK references `auth.users(id)` directly (the
--     same id `auth.uid()` returns), so owner status follows the auth account
--     and cascades away if the account is deleted.
--
-- NO-SELF-ASSIGNMENT GUARANTEE (the critical property):
--   A regular user has NO API path to become a platform owner.
--     * RLS is ENABLED on platform_admins with NO policies for anon/authenticated
--       -> every client INSERT/UPDATE/DELETE/SELECT is denied (no policy = deny).
--     * We additionally REVOKE ALL on the table from anon and authenticated, so
--       even Supabase's default non-DML grants (TRUNCATE/TRIGGER/REFERENCES) are
--       stripped — the publishable/anon key cannot touch this table at all.
--     * The ONLY way to insert a row is server-side as `service_role` (the
--       secret key), i.e. by us via migration/seed. service_role has BYPASSRLS
--       and is granted on the table explicitly below.
--
-- RLS STRATEGY FOR CROSS-ORG SUPER-ADMIN ACCESS — approach (b), chosen:
--   Platform owners need to read/manage across ALL organizations. Two options:
--     (a) widen every existing table's RLS with `OR auth_user_is_platform_owner()`
--         so an owner's normal (publishable-key) session can read all orgs; or
--     (b) keep ALL super-admin operations SERVER-SIDE ONLY via the service-role
--         key + an app-level owner check, adding NO new cross-org RLS policies.
--   We choose (b). It does NOT widen the client-facing trust surface at all:
--   normal tenant-isolation policies stay byte-for-byte unchanged, and an owner
--   gains ZERO extra power through their anon/publishable session. Super-admin
--   power lives only in trusted server code holding the secret key (which already
--   bypasses RLS); the owner check merely authorizes WHICH server actions an
--   owner may trigger. Blast radius is smaller: a stolen owner *session/JWT*
--   cannot read cross-org via the public API (the API/RLS knows nothing about
--   owners) — you'd need the server-only secret key. The cost is that
--   super-admin features must be built as server actions/routes, which for an
--   onboarding tool is appropriate and desirable.
--
--   CONSEQUENCE: this migration adds NO policies to organizations / users /
--   memberships / roles / role_permissions / membership_roles. Their existing
--   tenant-isolation policies are untouched and must remain so.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. platform_admins — the allowlist of platform owners.
-- -----------------------------------------------------------------------------
create table public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  note       text
);

comment on table  public.platform_admins            is 'Allowlist of PLATFORM OWNERS (super admins) — an access level above org admins. Locked to clients (RLS deny-all + REVOKE); writable only server-side via service_role. NOT self-assignable.';
comment on column public.platform_admins.user_id    is 'The auth.users id granted platform-owner status. Same value auth.uid() returns.';
comment on column public.platform_admins.note       is 'Optional audit note: who granted this / why.';

-- -----------------------------------------------------------------------------
-- Lock the table to all client roles.
-- -----------------------------------------------------------------------------
-- RLS ON + no policy => anon/authenticated are denied SELECT and all writes.
alter table public.platform_admins enable row level security;

-- Defense in depth: strip even the default non-DML grants so the publishable/
-- anon key has no privilege of any kind on this table. (No GRANT to anon or
-- authenticated is ever issued, and no policy exists, so it is fully sealed.)
revoke all on public.platform_admins from anon, authenticated;

-- service_role (secret key, server-side only) manages the allowlist. It also
-- receives this via the public-schema default privileges, but we grant
-- explicitly so this table's intent is self-contained and review-local.
grant all privileges on public.platform_admins to service_role;

-- NOTE: there are intentionally NO insert/update/delete/select POLICIES here.
-- Do not add client policies to this table without a separate security review.

-- -----------------------------------------------------------------------------
-- 2. auth_user_is_platform_owner() -> boolean
-- -----------------------------------------------------------------------------
-- True iff the currently authenticated user (auth.uid()) is in platform_admins.
--
-- Placed in the `public` schema (unlike the private RLS helpers) ON PURPOSE: the
-- app layer must be able to call it as a PostgREST RPC to authorize super-admin
-- server actions, and PostgREST only exposes functions in exposed schemas. It is
-- safe to expose because it returns ONLY a boolean ABOUT THE CALLER — it never
-- reveals the owner list to anyone.
--
-- SECURITY DEFINER (runs as owner, BYPASSES RLS) so it can read the sealed
-- platform_admins table; STABLE for planner caching; `set search_path = ''` with
-- every name fully schema-qualified to close the search-path-hijack hole — the
-- same hardening as our private helpers. It is also recursion-safe: it reads
-- only platform_admins, which has no policies that could call back into it.
-- -----------------------------------------------------------------------------
create or replace function public.auth_user_is_platform_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = auth.uid()
  );
$$;

comment on function public.auth_user_is_platform_owner() is 'True iff auth.uid() is a platform owner. SECURITY DEFINER (reads the sealed platform_admins table); returns only a self-boolean, never the owner list. Used by app-layer super-admin authorization.';

-- Functions default to EXECUTE for PUBLIC; lock that down and grant only to
-- authenticated (anon has no session, so it would only ever get false anyway).
revoke all on function public.auth_user_is_platform_owner() from public;
grant execute on function public.auth_user_is_platform_owner() to authenticated;
