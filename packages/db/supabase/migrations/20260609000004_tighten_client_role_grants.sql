-- =============================================================================
-- Migration: Tighten client-role baseline grants (defense in depth)
-- =============================================================================
--
-- Supabase's default privileges hand `anon` and `authenticated` the table-level
-- privileges TRUNCATE, TRIGGER, and REFERENCES on every table we create. None of
-- these are reachable through the PostgREST API (there is no TRUNCATE endpoint,
-- and clients can't create triggers/foreign keys), so the practical risk is low
-- — but TRUNCATE is destructive and is NOT gated by RLS, so stripping these from
-- the client roles is sensible defense in depth.
--
-- We do TWO things:
--   1. Revoke them from the client roles on every CURRENT public table.
--   2. Adjust the relevant DEFAULT PRIVILEGES so FUTURE tables don't re-grant
--      them — see the validated reasoning below.
--
-- We do NOT touch SELECT/INSERT (the access the app actually relies on, gated by
-- RLS) or any `service_role` grant (the trusted server-side role).
--
-- DEFAULT PRIVILEGES — validated, not guessed (via pg_default_acl):
--   These grants come from the `postgres`-owned default privileges for schema
--   public (anon/authenticated = Dxtm). Our migrations run AS `postgres` (proven:
--   migration 20260608000002's unqualified `alter default privileges ... to
--   service_role` created a postgres-owned default ACL entry), so an unqualified
--   `alter default privileges` here modifies exactly that default. We deliberately
--   leave the SEPARATE `supabase_admin`-owned default (which grants full
--   privileges) UNTOUCHED — it is Supabase-managed, and our tables are
--   postgres-owned so they never use it. Only the three named privileges are
--   removed; MAINTAIN is left as-is (non-destructive, out of scope).
-- =============================================================================

-- 1. Current tables — strip the three privileges from the client roles.
--    (platform_admins was already REVOKE ALL'd in 20260609000001; included here
--     for uniformity — it is a harmless no-op.)
revoke truncate, trigger, references on
  public.organizations,
  public.users,
  public.memberships,
  public.roles,
  public.permissions,
  public.role_permissions,
  public.membership_roles,
  public.messages,
  public.platform_admins
from anon, authenticated;

-- 2. Future tables — stop the postgres-owned default from granting them.
alter default privileges in schema public
  revoke truncate, trigger, references on tables from anon, authenticated;
