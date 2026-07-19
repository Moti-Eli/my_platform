-- =============================================================================
-- Migration: public.set_member_role — ATOMIC Member<->Admin switch
-- =============================================================================
--
-- The staff tool switches a member between Member and Admin by ADDING one role and
-- REMOVING the other. Done as two separate client writes (upsert then delete), that
-- pair is NOT atomic: when `keep_org_admin` rejects the delete (demoting the org's
-- last admin), the add has already committed, leaving the member with a redundant
-- role row. This function collapses the pair into ONE transaction — one function
-- body — so a rejected step rolls the whole thing back and no orphan role row is
-- left behind. It replaces the non-transactional upsert+delete in staff/logic.ts.
--
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER DOES NOT BYPASS THE AUTHORIZATION TRIGGERS
-- -----------------------------------------------------------------------------
-- This runs as SECURITY DEFINER, but that changes only the EXECUTING ROLE, never
-- who `auth.uid()` reports. `auth.uid()` reads the request's JWT claim, which is the
-- INVOKING user regardless of the function's security context. So the membership_roles
-- BEFORE-ROW guard (`no_escalation`, 20260717000003) and the last-admin guard
-- (`keep_org_admin`) BOTH still fire on the INSERT/DELETE below, and both still read
-- `auth.uid()` = the caller:
--
--   * a NON-ADMIN calling this is rejected by `no_escalation`
--     (auth_user_may_assign_role returns false for a caller who holds neither an
--     admin role nor the role being conferred), exactly as a direct write would be;
--   * demoting the org's LAST admin is rejected by `keep_org_admin`.
--
-- This is not a hope about trigger timing — it is the triggers' own contract: they
-- "fire for service_role too" (see 20260717000003's header), i.e. they fire for any
-- caller, SECURITY DEFINER included, and decide on `auth.uid()`. This function
-- therefore does NOT re-implement either check; it only SEQUENCES the two writes
-- atomically and lets the triggers' exceptions propagate to the caller (the Cortex
-- data-layer maps them to a stable code).
--
-- Fully-qualified names + `set search_path = ''`: the same search-path-locked
-- pattern as every helper in 20260717000003.
-- =============================================================================

create or replace function public.set_member_role(
  p_membership_id uuid,
  p_target_role text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id         uuid;
  v_admin_role_id  uuid;
  v_member_role_id uuid;
  v_add_role_id    uuid;
  v_remove_role_id uuid;
begin
  -- Validate the target role up front.
  if p_target_role not in ('admin', 'member') then
    raise exception 'set_member_role: p_target_role must be ''admin'' or ''member'', got %', p_target_role
      using errcode = 'invalid_parameter_value';
  end if;

  -- Resolve the membership's org. Must exist and not be soft-deleted.
  select m.organization_id
    into v_org_id
  from public.memberships m
  where m.id = p_membership_id
    and m.deleted_at is null;
  if v_org_id is null then
    raise exception 'set_member_role: membership % not found (or soft-deleted)', p_membership_id;
  end if;

  -- Resolve this org's admin role (is_admin) and member role (non-admin, preferring
  -- the one named 'Member' — mirrors staff/logic.ts's resolution).
  select r.id
    into v_admin_role_id
  from public.roles r
  where r.organization_id = v_org_id
    and r.is_admin
  limit 1;

  select r.id
    into v_member_role_id
  from public.roles r
  where r.organization_id = v_org_id
    and not r.is_admin
  order by (r.name = 'Member') desc
  limit 1;

  if v_admin_role_id is null or v_member_role_id is null then
    raise exception 'set_member_role: organization % is missing an admin or member role', v_org_id;
  end if;

  -- Which role to add, which to remove.
  if p_target_role = 'admin' then
    v_add_role_id    := v_admin_role_id;
    v_remove_role_id := v_member_role_id;
  else
    v_add_role_id    := v_member_role_id;
    v_remove_role_id := v_admin_role_id;
  end if;

  -- Add the target role (no-op if already held), THEN remove the other. One function
  -- body = one transaction: if the DELETE's keep_org_admin trigger raises (last admin),
  -- the INSERT above rolls back too, so nothing is left half-applied. The exception is
  -- NOT caught here — it propagates for the caller to map.
  insert into public.membership_roles (membership_id, role_id, organization_id)
  values (p_membership_id, v_add_role_id, v_org_id)
  on conflict (membership_id, role_id) do nothing;

  delete from public.membership_roles
  where membership_id = p_membership_id
    and role_id = v_remove_role_id
    and organization_id = v_org_id;
end;
$$;

comment on function public.set_member_role(uuid, text) is 'Atomically switch one membership between Member and Admin: adds the target role and removes the other in a single transaction, so a rejected step (e.g. keep_org_admin refusing to demote the last admin) rolls the whole change back — no orphan role row. SECURITY DEFINER, but authorization is UNCHANGED: the membership_roles no_escalation / keep_org_admin triggers still fire and still read auth.uid() (the invoking user), so a non-admin caller is still rejected. Does not re-implement those checks.';

grant execute on function public.set_member_role(uuid, text) to authenticated;
