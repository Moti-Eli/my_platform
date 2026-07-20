-- =============================================================================
-- Migration: Add the `plan` entitlement column to organizations
-- =============================================================================
--
-- Adds a single entitlement flag to public.organizations. It is ADDITIVE and
-- changes NO behavior: nothing gates on `plan` yet (that is a later step). The
-- column ships with a backfilling default so every existing row becomes 'solo'
-- in place — no data migration, no window where a row lacks a plan.
--
-- -----------------------------------------------------------------------------
-- WHO CAN CHANGE IT: PLATFORM OWNER, SERVER-SIDE ONLY — BY ABSENCE OF POLICY
-- -----------------------------------------------------------------------------
-- `plan` is an entitlement, so it must not be self-serve. There is deliberately
-- no INSERT/UPDATE RLS policy on organizations for `authenticated`, so a normal
-- user's session cannot alter it (or any organization row) at all — the only way
-- it changes is a platform owner acting through the service-role client, exactly
-- as org provisioning already does. No new policy is added here: members can
-- already READ their org (and therefore this column) via the existing
-- "members can read their organizations" SELECT policy, which is all any client
-- needs — reading the entitlement to decide what to show.
-- =============================================================================

-- Backfilling default: existing rows become 'solo'; new self-signup orgs get
-- 'solo' too. 'team' is the elevated tier that unlocks member management.
alter table public.organizations
  add column plan text not null default 'solo';

-- Named check constraint (not an inline unnamed one) so it can be referenced and
-- altered by name later.
alter table public.organizations
  add constraint organizations_plan_check check (plan in ('solo', 'team'));

comment on column public.organizations.plan is
  'Entitlement flag. ''solo'' is the default every self-signup org gets; ''team'' '
  'unlocks member management. Changed ONLY server-side by a platform owner: there '
  'is no INSERT/UPDATE RLS policy on organizations for `authenticated`, so normal '
  'users cannot alter it (deliberate). Members can READ it via the existing '
  '"members can read their organizations" SELECT policy, so no new policy is needed.';
