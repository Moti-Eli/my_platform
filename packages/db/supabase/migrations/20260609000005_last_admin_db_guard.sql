-- =============================================================================
-- Migration: DB-level "never leave an org with zero admins" guard
-- =============================================================================
--
-- The rule "an organization must never be left with zero admins" was previously
-- enforced only in the app (the member-management server action counts admins
-- before demoting). A direct API caller with `members.manage` — or anyone using
-- the service key — could bypass that and strip the last admin. This migration
-- enforces the invariant in the DATABASE, so it holds even against direct
-- privileged calls.
--
-- MECHANISM — a DEFERRABLE, INITIALLY DEFERRED CONSTRAINT TRIGGER that evaluates
-- the FINAL state of the transaction at COMMIT. This is deliberate:
--   * A naive BEFORE/AFTER-statement trigger would see a half-applied state
--     during CASCADE deletes (e.g. `delete from organizations` cascades to
--     memberships + membership_roles) and would wrongly reject legitimate org/
--     user deletion — and would break the dev seed's cleanup.
--   * Deferring to commit means we judge the end result: if the organization no
--     longer exists (it was deleted), the rule is moot; if it still exists and
--     still has members but has lost its last admin assignment, we reject.
--   * A well-behaved single transaction that swaps admins (add new admin, drop
--     old) is allowed, because the net final state still has an admin.
--
-- SECURITY: the trigger function is SECURITY DEFINER with `set search_path = ''`
-- (fully schema-qualified), so it counts admins bypassing RLS — its decision
-- can't be fooled by a caller's limited row visibility, and it fires for every
-- role including `service_role`. It only reads (no recursion: triggers don't fire
-- on SELECT). Lives in the private (non-API-exposed) schema like our other
-- helpers; it is never callable directly.
-- =============================================================================

create or replace function private.enforce_org_keeps_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := old.organization_id;
begin
  -- Org gone (deleted / cascaded away) -> the invariant is moot. Allow.
  if not exists (select 1 from public.organizations o where o.id = v_org) then
    return null;
  end if;

  -- Org still exists AND still has at least one member, but no admin-role
  -- assignment remains -> we'd be stranding real members with no admin. Reject.
  if exists (
       select 1 from public.memberships m where m.organization_id = v_org
     )
     and not exists (
       select 1
       from public.membership_roles mr
       join public.roles r on r.id = mr.role_id
       where mr.organization_id = v_org
         and r.is_admin
     )
  then
    raise exception 'Cannot remove the last admin of organization %', v_org
      using errcode = 'check_violation',
            hint = 'Assign an admin role to another member before removing this one.';
  end if;

  return null;
end;
$$;

comment on function private.enforce_org_keeps_admin() is 'Constraint-trigger guard: rejects an operation that would leave an existing organization (with members) holding zero is_admin role assignments. Deferred to commit so cascade deletes of the whole org/user are unaffected.';

-- Trigger function is invoked by the trigger, never called directly.
revoke all on function private.enforce_org_keeps_admin() from public;

-- Fires per affected row, at COMMIT, for DELETE and UPDATE on membership_roles.
-- (INSERT can only ADD an admin assignment, so it is not guarded.)
create constraint trigger membership_roles_keep_org_admin
  after delete or update on public.membership_roles
  deferrable initially deferred
  for each row
  execute function private.enforce_org_keeps_admin();
