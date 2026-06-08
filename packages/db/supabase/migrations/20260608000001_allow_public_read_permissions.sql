-- =============================================================================
-- Migration: Make the global permission catalog publicly readable
-- =============================================================================
--
-- Step 2 enabled RLS and scoped the `permissions` SELECT policy to the
-- `authenticated` role. The permission catalog, however, is GLOBAL,
-- code-defined, non-sensitive REFERENCE data — the fixed vocabulary of actions
-- the application checks for. It contains no tenant or user data.
--
-- The web app's public landing page performs a Supabase health check that reads
-- this catalog using the anon/publishable key (no logged-in user). For that to
-- work — and to match the intended "globally readable" semantics of the
-- catalog — `anon` must be able to read it too.
--
-- IMPORTANT: this does NOT relax tenant isolation anywhere else. Every
-- org-scoped table (organizations, users, memberships, roles, role_permissions,
-- membership_roles) remains members-only under its existing RLS policies. Only
-- this single global reference table becomes anon-readable. Writes remain
-- denied (no write policies).
-- =============================================================================

-- Replace the authenticated-only read policy with one that also allows anon.
drop policy "authenticated can read the global permission catalog" on public.permissions;

create policy "anyone can read the global permission catalog"
  on public.permissions
  for select
  to anon, authenticated
  using ( true );

-- RLS filters rows; the role still needs table-level SELECT privilege.
grant select on public.permissions to anon;
