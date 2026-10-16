-- =============================================================================
-- Migration: Tighten client-role grants on the Cortex tables + future public tables
-- =============================================================================
--
-- 20260605000002 states the rule this migration is enforcing: "all mutations must
-- go through the server (service_role / secret key), which bypasses RLS". Cortex
-- has followed that rule in POLICY (every Cortex table has SELECT policies only,
-- so writes are denied) but not in GRANTS: `anon` and `authenticated` still hold
-- INSERT/UPDATE/DELETE at the table level on every Cortex table, inherited from
-- Supabase's default privileges. RLS is currently the ONLY thing standing between
-- a publishable key and writing them.
--
-- Verified against the live database before writing this (not assumed):
--   inventory_items / app_instances / groups / group_members
--     anon          = DELETE, INSERT, SELECT, UPDATE   (relacl: anon=arwdm)
--     authenticated = DELETE, INSERT, SELECT, UPDATE   (relacl: authenticated=arwdm)
--   record_grants
--     anon, authenticated = NOTHING (relacl lists only postgres + service_role)
--   pg_default_acl, schema public, owner=postgres, objtype=r
--     anon=arwdm, authenticated=arwdm  <- the source of the above
--
-- record_grants is therefore ALREADY fully sealed by 20260716000004's own
-- `revoke all` and is deliberately NOT touched here — there is nothing left to
-- revoke. It stays the model the other four are being brought up to.
--
-- RLS SHOULD NOT BE THE ONLY LAYER. It is a good layer and it is working — anon
-- gets zero rows from these tables today because every policy on them is `to
-- authenticated`. But "no rows come back" and "you have no privilege" are
-- different guarantees, and only the second one survives a policy being dropped,
-- mis-scoped, or written `to public` by mistake. After this migration anon gets a
-- permission error instead of an empty set, which is the observable difference.
--
-- -----------------------------------------------------------------------------
-- SCOPE BOUNDARY — READ THIS BEFORE ASSUMING THIS MIGRATION IS INCOMPLETE
-- -----------------------------------------------------------------------------
-- 1. This changes NO EXISTING my-platform table's grants. organizations, users,
--    memberships, roles, permissions, role_permissions, membership_roles,
--    messages and platform_admins keep INSERT/UPDATE/DELETE for `authenticated`,
--    gated by RLS alone. That is a KNOWN, DELIBERATELY DEFERRED DEBT, recorded in
--    docs/Cortex-Roadmap.md — my-platform is a working asset with live policies
--    (messages has a real client INSERT policy, for one), and re-grant-auditing it
--    is its own task with its own harness. Not in scope here; not an oversight.
--
-- 2. It DOES change what FUTURE my-platform tables receive, via the default
--    privileges below. That is intended, and it is not a new rule — it is
--    20260605000002's own rule, finally applied at the grant layer instead of only
--    the policy layer. A future table that genuinely needs client writes can grant
--    them EXPLICITLY, in its own migration, where a reviewer sees it. Explicit and
--    visible beats inherited and silent: the current default hands out write
--    access to every table anyone ever creates, whether they thought about it or
--    not, and nothing in the diff shows it happening.
--
-- 3. WHY CHANGE THE DEFAULT AT ALL, rather than just revoking per table?
--    Because a per-table-only fix means every future tool migration must REMEMBER
--    to revoke. That is a rule living in someone's head and a second source of
--    truth — the exact pattern this repo has been burned by three times (see the
--    roadmap's first standing rule). Forget it once and a tool table ships with
--    client write access nobody notices, because nothing fails. Fixing the default
--    makes the safe thing the automatic thing: a new table is tight unless someone
--    deliberately opens it. 20260609000004 already established default-privileges
--    adjustment as the pattern here; this is the same move for a different set of
--    privileges.
--
-- -----------------------------------------------------------------------------
-- DEFAULT PRIVILEGES — validated, not guessed (the 20260609000004 reasoning)
-- -----------------------------------------------------------------------------
-- These grants come from the `postgres`-owned default privileges for schema public
-- (probed above: anon/authenticated = arwdm for objtype=r). Our migrations run AS
-- `postgres` — proven originally by 20260608000002's unqualified `alter default
-- privileges ... to service_role` creating a postgres-owned default ACL entry — so
-- an unqualified `alter default privileges` here modifies exactly that default.
--
-- We deliberately leave the SEPARATE `supabase_admin`-owned default (which grants
-- the full arwdDxtm) UNTOUCHED: it is Supabase-managed, and our tables are
-- postgres-owned so they never use it. Confirmed by the probe — every Cortex
-- table's relacl is `.../postgres`, none `.../supabase_admin`.
--
-- SELECT IS DELIBERATELY NOT REVOKED FROM THE DEFAULT. 20260605000002 grants
-- SELECT explicitly per table anyway ("we explicitly grant SELECT on each table to
-- authenticated"), so the default's SELECT is redundant for our tables — but
-- removing it from the default would silently change every future table across the
-- whole platform, including ones outside Cortex, and would break any table whose
-- author reasonably expects Supabase's baseline. That is a wider blast radius than
-- this migration should carry, and it belongs with the my-platform grant audit in
-- (1). MAINTAIN (`m`) is likewise left as-is, matching 20260609000004's stance:
-- non-destructive, out of scope.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Current Cortex tables — strip client write privileges.
-- -----------------------------------------------------------------------------
-- `authenticated` keeps SELECT: every Cortex SELECT policy depends on it (RLS
-- filters rows, it does not grant table privileges). Writes go through the shell
-- as service_role, which is untouched below.
revoke insert, update, delete on
  public.inventory_items,
  public.app_instances,
  public.groups,
  public.group_members
from anon, authenticated;

-- `anon` loses EVERYTHING on the Cortex tables, SELECT included. Anon has no
-- business reading Cortex data at all: every policy on these four is `to
-- authenticated`, so anon already receives zero rows. This makes that a privilege
-- boundary rather than a side effect of how the policies happen to be scoped.
revoke all on
  public.inventory_items,
  public.app_instances,
  public.groups,
  public.group_members
from anon;

-- NOT TOUCHED — public.record_grants. It is already fully revoked from both anon
-- and authenticated by 20260716000004 (verified: its relacl lists only postgres
-- and service_role). Re-revoking would be a no-op that implies there was something
-- to fix. It stays sealed.
--
-- NOT TOUCHED — service_role, on any table. The shell writes as service_role
-- (Cortex writes, the defaultGrants bootstrap, the seed). Revoking any of it
-- breaks the only write path there is.

-- -----------------------------------------------------------------------------
-- 2. Future tables — stop the postgres-owned default from granting client writes.
-- -----------------------------------------------------------------------------
-- After this, a new table in `public` created by our migrations gives anon and
-- authenticated SELECT (+MAINTAIN) but NO insert/update/delete. service_role's
-- default (from 20260608000002) is unaffected and still grants it everything.
alter default privileges in schema public
  revoke insert, update, delete on tables from anon, authenticated;
