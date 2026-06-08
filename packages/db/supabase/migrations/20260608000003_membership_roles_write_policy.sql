-- =============================================================================
-- Migration: Permission-checked WRITE policy for membership_roles (Task A)
-- =============================================================================
--
-- This opens the FIRST write path in the schema: assigning / unassigning roles
-- to a membership (i.e. changing a member's roles). Everything else stays
-- write-locked (no policy = denied).
--
-- The rule: a user may INSERT/UPDATE/DELETE a membership_roles row only if they
-- have the 'members.manage' permission IN THAT ROW'S ORGANIZATION. The check is
-- enforced at the DATABASE level via RLS, not just in app code.
--
-- RECURSION SAFETY: the permission check reads memberships/membership_roles/
-- roles/role_permissions/permissions. Doing that directly in a policy on
-- membership_roles would recurse. So the check lives in a SECURITY DEFINER
-- function (runs as owner, BYPASSES RLS), STABLE, with `SET search_path = ''`
-- and fully schema-qualified names — the same recursion-safe, search-path-locked
-- pattern as our existing membership-check helpers.
--
-- ORG-ISOLATION (airtight): the policies key on the ROW's `organization_id` and
-- check the acting user's permission IN THAT org. Combined with the composite
-- foreign keys added in Step 1 — (membership_id, organization_id) -> memberships
-- and (role_id, organization_id) -> roles — `organization_id` cannot be spoofed
-- to a different org than the membership/role it points at. So a user with
-- 'members.manage' in org A literally cannot write a membership_roles row for
-- org B: either the org id is B (and the permission check fails) or the org id
-- is A (and the composite FK to B's membership/role fails).
--
-- PRIVILEGE-ESCALATION ASSUMPTION (REVISIT WHEN PERMISSIONS BECOME UI-EDITABLE):
-- 'members.manage' is currently granted ONLY to admin roles (the seeded Member
-- role has only users.view / users.invite). So only admins can assign/unassign
-- roles — including the Admin role. A regular member therefore cannot escalate
-- their own privileges. This is acceptable for now. IF 'members.manage' is ever
-- granted to a non-admin role, that role could grant the Admin role to anyone
-- (including itself) or strip other admins. Before that happens, add guardrails
-- — e.g. forbid removing the last admin of an org, and forbid self-escalation —
-- in application logic and/or stricter policies.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: does the current user have <permission_key> in <organization>?
-- -----------------------------------------------------------------------------
-- True when auth.uid() has a membership in p_org_id and at least one of their
-- roles there is is_admin OR is linked (via role_permissions) to a permission
-- with the given key. SECURITY DEFINER bypasses RLS on the joined tables, which
-- is what keeps the calling policy from recursing.
-- -----------------------------------------------------------------------------
create or replace function private.auth_user_has_permission(
  p_org_id uuid,
  p_permission_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.membership_roles mr on mr.membership_id = m.id
    join public.roles r on r.id = mr.role_id
    where m.user_id = auth.uid()
      and m.organization_id = p_org_id
      and (
        r.is_admin
        or exists (
          select 1
          from public.role_permissions rp
          join public.permissions p on p.id = rp.permission_id
          where rp.role_id = r.id
            and p.key = p_permission_key
        )
      )
  );
$$;

grant execute on function private.auth_user_has_permission(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Table privileges: RLS filters rows, but the role still needs DML grants.
-- We open INSERT/UPDATE/DELETE on membership_roles to `authenticated`; the RLS
-- policies below decide which rows they may actually write. No other table is
-- granted writes.
-- -----------------------------------------------------------------------------
grant insert, update, delete on public.membership_roles to authenticated;

-- INSERT — assign a role to a membership. WITH CHECK validates the NEW row.
create policy "members.manage can assign membership roles"
  on public.membership_roles
  for insert
  to authenticated
  with check ( private.auth_user_has_permission(organization_id, 'members.manage') );

-- DELETE — unassign a role. USING selects which existing rows may be deleted.
create policy "members.manage can unassign membership roles"
  on public.membership_roles
  for delete
  to authenticated
  using ( private.auth_user_has_permission(organization_id, 'members.manage') );

-- UPDATE — change an existing membership-role row. USING gates the existing row,
-- WITH CHECK gates the resulting row (the composite FK forces both to the same
-- org, so the permission must hold for that one org).
create policy "members.manage can update membership roles"
  on public.membership_roles
  for update
  to authenticated
  using ( private.auth_user_has_permission(organization_id, 'members.manage') )
  with check ( private.auth_user_has_permission(organization_id, 'members.manage') );
