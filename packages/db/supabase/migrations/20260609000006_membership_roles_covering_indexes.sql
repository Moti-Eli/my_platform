-- =============================================================================
-- Migration: Covering indexes for the membership_roles composite foreign keys
-- =============================================================================
--
-- The Supabase performance advisor flags the two composite FKs on
-- `membership_roles` as lacking a covering index:
--   * membership_roles_membership_fk -> (membership_id, organization_id)
--   * membership_roles_role_fk       -> (role_id, organization_id)
-- Without a covering index, deleting a parent row (a membership or a role) makes
-- Postgres sequentially scan membership_roles to find dependents. Harmless while
-- the table is tiny, but it's the kind of thing that bites later, so add the
-- covering indexes now.
--
-- The existing single-column `membership_roles_role_id_idx (role_id)` becomes
-- REDUNDANT once we add `(role_id, organization_id)` — that composite leads with
-- role_id, so it serves role_id-only lookups too. Drop it in the same migration.
--
-- We KEEP `membership_roles_organization_id_idx (organization_id)` — it backs the
-- org-scoped RLS reads and the last-admin guard's per-org admin count.
-- =============================================================================

-- Covering index for the membership composite FK.
create index if not exists membership_roles_membership_org_idx
  on public.membership_roles (membership_id, organization_id);

-- Covering index for the role composite FK.
create index if not exists membership_roles_role_org_idx
  on public.membership_roles (role_id, organization_id);

-- Now redundant: the new role_org index leads with role_id.
drop index if exists public.membership_roles_role_id_idx;
