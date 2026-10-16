-- =============================================================================
-- Migration: org-tree ADMIN read path into 'private' rows
-- =============================================================================
--
-- Two pieces, read-only end to end:
--   1. `private.auth_user_is_admin_of_tree(org_id)` — the admin sibling of
--      `auth_user_is_member_of_tree` (20260716000001): same recursive ancestor
--      walk, same active-only guards, but the caller must HOLD a role with
--      `is_admin = true` in the row's own org or in an ANCESTOR of it.
--   2. `private.auth_user_can_read` re-issued with EXACTLY ONE change: the
--      'private' branch now admits the owner OR a tree admin.
--
-- Nothing else moves. `auth_user_can_write` and every write path are untouched;
-- the wired SELECT policies keep calling `auth_user_can_read` unchanged.
--
-- -----------------------------------------------------------------------------
-- THE ADMIN ESCAPE IS SCOPED INSIDE THE 'private' BRANCH — NOT A TOP-LEVEL OR
-- -----------------------------------------------------------------------------
-- It is tempting to hoist `auth_user_is_admin_of_tree(p_org_id)` to the top of
-- the function as "admins see everything". That hoist is exactly wrong, twice:
--
--   * A top-level OR would let an admin read 'restricted' rows WITHOUT a
--     `record_grants` match, silently bypassing the entire grant model that
--     20260716000004/5 built. 'restricted' means "only who was named", and an
--     admin who wants in can be named like anyone else.
--   * The 20260716000005 header documents why nothing may sit beside the
--     blocking `is_member_of_tree` AND: any top-level OR branch is a membership
--     re-check waiting to be forgotten. The admin check happens to imply tree
--     membership today (an is_admin role rides on an active membership in the
--     tree), but "happens to imply" is not a contract — inside the branch, the
--     blocking AND still gates it by construction.
--
-- So: 'org' unchanged, 'restricted' unchanged, and 'private' widens from
-- "the owner" to "the owner, or an admin somewhere on the path from the row's
-- org up to its root". Inheritance stays DOWNWARD ONLY — an admin of a child
-- org reads nothing extra of its parent's private rows.
--
-- -----------------------------------------------------------------------------
-- WHY THE ADMIN WALK MIRRORS auth_user_is_member_of_tree EXACTLY
-- -----------------------------------------------------------------------------
-- Same chain CTE, byte for byte: the target org itself (active only), then
-- ancestors (active only), depth-capped at 32. A soft-deleted mid-tree org is
-- neither matched nor walked THROUGH, so soft-deleting it detaches the subtree
-- from its ancestors' admin reach exactly as it does for plain membership.
-- The org-active guard on the membership's own org is STRUCTURAL, same as in
-- the member version: the join target `c.id` can only be an active org because
-- the chain admits nothing else. The membership must be active
-- (`m.deleted_at is null`) — and, unlike the member version, the membership
-- must carry a role with `is_admin = true`, checked through membership_roles
-- (role HOLDING, per the 20260716000005 header's warning — never through
-- auth_user_can_access_role, which is mere org membership).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. private.auth_user_is_admin_of_tree(org_id) -> boolean
-- -----------------------------------------------------------------------------
-- True when the authenticated user holds an is_admin role in p_org_id ITSELF,
-- or in ANY ANCESTOR of it. Downward only — an admin of a CHILD of p_org_id is
-- NOT enough. NULL auth.uid() (anon): `m.user_id = auth.uid()` is NULL for
-- every row, so no row matches and EXISTS is false.
-- -----------------------------------------------------------------------------
create or replace function private.auth_user_is_admin_of_tree(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with recursive chain as (
    -- The target org itself (depth 1), only if it is active.
    select o.id, o.parent_id, 1 as depth
    from public.organizations o
    where o.id = p_org_id
      and o.deleted_at is null
    union all
    -- Walk UP to the ancestors, active-only, hard-capped at 32 levels.
    select p.id, p.parent_id, c.depth + 1
    from chain c
    join public.organizations p on p.id = c.parent_id
    where c.depth < 32
      and p.deleted_at is null
  )
  select exists (
    select 1
    from chain c
    join public.memberships m on m.organization_id = c.id
    join public.membership_roles mr on mr.membership_id = m.id
    join public.roles r on r.id = mr.role_id
    where m.user_id = auth.uid()
      and m.deleted_at is null
      and r.is_admin
  );
$$;

comment on function private.auth_user_is_admin_of_tree(uuid) is 'True when auth.uid() has an active membership carrying an is_admin role in the given organization OR in any of its ancestors (inheritance flows DOWNWARD only; a child org''s admin gets no reach into the parent). Active-only walk, depth-capped at 32. Admin sibling of auth_user_is_member_of_tree.';

-- Same grant as the existing membership helpers (`anon` never gets USAGE on the
-- private schema, so anon cannot reach this).
grant execute on function private.auth_user_is_admin_of_tree(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. private.auth_user_can_read — re-issued with ONE change: the 'private'
--    branch admits the owner OR a tree admin. Everything else is byte-for-byte
--    identical to 20260716000005. See that migration's header for the full
--    rationale behind the shape; see this file's header for why the admin
--    escape lives INSIDE the branch.
-- -----------------------------------------------------------------------------
create or replace function private.auth_user_can_read(
  p_table_name text,
  p_record_id  uuid,
  p_org_id     uuid,
  p_owner_id   uuid,
  p_visibility text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    -- BLOCKS FIRST. Never an OR branch. See the header.
    private.auth_user_is_member_of_tree(p_org_id)
    and (
      p_visibility = 'org'

      or (
        p_visibility = 'private'
        and (
          p_owner_id = auth.uid()
          or private.auth_user_is_admin_of_tree(p_org_id)
        )
      )

      or (
        p_visibility = 'restricted'
        and exists (
          select 1
          from public.record_grants rg
          where rg.table_name = p_table_name
            and rg.record_id = p_record_id
            and (
              -- (a) Granted to the PERSON. No further check: identity does not go
              --     stale, and is_member_of_tree already proved they are in the tree.
              rg.subject_user_id = auth.uid()

              -- (b) Granted to a ROLE THE USER HOLDS. Goes through membership_roles
              --     (holding), NOT auth_user_can_access_role (mere org membership).
              --     The deleted_at checks are load-bearing — see the header.
              or (
                rg.subject_role_id is not null
                and exists (
                  select 1
                  from public.membership_roles mr
                  join public.memberships m   on m.id = mr.membership_id
                  join public.organizations o on o.id = m.organization_id
                  where mr.role_id = rg.subject_role_id
                    and m.user_id = auth.uid()
                    and m.deleted_at is null
                    and o.deleted_at is null
                )
              )

              -- (c) Granted to a GROUP THE USER IS IN. Same staleness problem, same
              --     fix: group_members survives a soft-deleted membership.
              or (
                rg.subject_group_id is not null
                and exists (
                  select 1
                  from public.group_members gm
                  join public.memberships m
                    on m.user_id = gm.user_id
                   and m.organization_id = gm.org_id
                  join public.organizations o on o.id = m.organization_id
                  where gm.group_id = rg.subject_group_id
                    and gm.user_id = auth.uid()
                    and m.deleted_at is null
                    and o.deleted_at is null
                )
              )
            )
        )
      )
    );
$$;

comment on function private.auth_user_can_read(text, uuid, uuid, uuid, text) is 'Row-level read check for Cortex tool tables. Membership in the row''s org tree is a BLOCKING AND; on top of it, ''org'' is readable by the tree, ''private'' by its owner or by a user holding an is_admin role in the row''s org tree (auth_user_is_admin_of_tree — deliberately scoped inside the private branch, NOT a top-level escape, so admins cannot bypass record_grants on ''restricted'' rows), ''restricted'' only via a record_grants match (user / held role / joined group). Role and group grants re-check that the backing membership and its org are ACTIVE — those rows survive a soft-deleted membership. Never uses auth_user_can_access_role (that is org-membership, not role-holding).';
