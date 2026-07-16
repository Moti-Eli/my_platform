-- =============================================================================
-- Migration: Organization hierarchy (parent_id) + tree-aware membership helper
-- =============================================================================
--
-- Adds a self-referencing PARENT link to `organizations`, turning the flat tenant
-- list into a forest (root orgs have parent_id = NULL), plus a membership helper
-- that understands that forest.
--
-- SCOPE — additive only. This migration adds the column, a cycle guard, and one
-- new function. It deliberately does NOT touch any existing RLS policy: every
-- policy today calls `private.auth_user_is_member_of`, and they keep doing so, so
-- visibility is completely unchanged by this migration. Rewiring policies onto
-- the tree helper is a separate, individually-reviewable step.
--
-- INHERITANCE DIRECTION — DOWNWARD ONLY (this is the whole security question):
-- a member of a PARENT org inherits access to its DESCENDANTS; a member of a
-- CHILD org gets NOTHING extra — in particular, no access to its parent or to
-- sibling subtrees. Inheriting upward would let a leaf-org member read the whole
-- tenant above them, which is exactly the escalation this model must not permit.
--
-- ON DELETE RESTRICT — deleting an org that still has children is rejected. The
-- alternative (CASCADE) would silently delete an entire subtree of tenants, and
-- SET NULL would silently promote children to roots. Both are too destructive to
-- happen implicitly; a caller must re-parent or delete children explicitly.
-- Note this means teardown must delete children BEFORE parents.
--
-- CYCLE GUARD — parent_id is a plain FK, which cannot express "acyclic". A cycle
-- (A -> B -> A) would make every ancestor walk loop forever, so it is rejected at
-- write time by a BEFORE INSERT OR UPDATE trigger. Both walks below are bounded
-- by a hard depth cap of 32, which also means a pre-existing cycle (impossible
-- via this trigger, but possible via a future bad migration) degrades to a bounded
-- walk instead of an infinite one.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. organizations.parent_id — nullable self-reference (NULL = root org).
-- -----------------------------------------------------------------------------
alter table public.organizations
  add column parent_id uuid references public.organizations(id) on delete restrict;

comment on column public.organizations.parent_id is 'Parent organization (NULL = root org). Membership inherits DOWNWARD only: a member of this org also reaches its descendants, never its ancestors. ON DELETE RESTRICT — re-parent or delete children first.';

-- Index the FK: the ancestor walk joins on it, and an unindexed FK also makes
-- every delete of a parent scan the whole table to enforce RESTRICT.
create index organizations_parent_id_idx on public.organizations (parent_id);

-- -----------------------------------------------------------------------------
-- 2. Cycle guard.
-- -----------------------------------------------------------------------------
-- Rejects any INSERT/UPDATE whose parent_id would close a loop:
--   * parent_id = own id (self-parent), or
--   * parent_id points at a DESCENDANT of this row.
--
-- MECHANISM: walk UP from the PROPOSED parent. If this row's own id appears
-- anywhere in that ancestor chain, the proposed parent is a descendant of this
-- row, so the new edge would close a cycle. Walking up from the proposed parent
-- (rather than down from this row) is what makes the check work identically for
-- INSERT and UPDATE — on INSERT the row has no descendants yet, and the walk
-- simply finds nothing.
--
-- SECURITY DEFINER: the walk must see the TRUE hierarchy. A caller subject to RLS
-- can only see orgs they belong to, so without SECURITY DEFINER the chain would
-- come back short and a cycle could slip through. `set search_path = ''` with
-- fully-qualified names matches our other private helpers.
-- -----------------------------------------------------------------------------
create or replace function private.enforce_org_parent_no_cycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hits_self boolean;
  v_max_depth int;
begin
  -- Root org, or parent unchanged on UPDATE -> nothing to verify.
  if new.parent_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.parent_id is not distinct from new.parent_id then
    return new;
  end if;

  -- Cheap, explicit case first, so it gets its own clear message.
  if new.parent_id = new.id then
    raise exception 'Organization % cannot be its own parent', new.id
      using errcode = 'check_violation',
            hint = 'A root organization has parent_id = NULL.';
  end if;

  with recursive chain as (
    -- Start AT the proposed parent (depth 1)...
    select o.id, o.parent_id, 1 as depth
    from public.organizations o
    where o.id = new.parent_id
    union all
    -- ...and walk up toward the root, hard-capped at 32 levels.
    select p.id, p.parent_id, c.depth + 1
    from chain c
    join public.organizations p on p.id = c.parent_id
    where c.depth < 32
  )
  select bool_or(c.id = new.id), max(c.depth)
    into v_hits_self, v_max_depth
  from chain c;

  if coalesce(v_hits_self, false) then
    raise exception 'Organization % cannot be parented to % — that would create a cycle', new.id, new.parent_id
      using errcode = 'check_violation',
            hint = 'The proposed parent is a descendant of this organization.';
  end if;

  -- Hit the cap without resolving to a root: either the tree is deeper than we
  -- support, or the existing data already contains a cycle. Either way we cannot
  -- certify this edge as safe, so we refuse it rather than allow an unbounded walk.
  if coalesce(v_max_depth, 0) >= 32 then
    raise exception 'Organization hierarchy above % exceeds the maximum depth of 32', new.parent_id
      using errcode = 'program_limit_exceeded',
            hint = 'Flatten the hierarchy; ancestor walks are bounded at 32 levels.';
  end if;

  return new;
end;
$$;

comment on function private.enforce_org_parent_no_cycle() is 'BEFORE INSERT/UPDATE guard on organizations.parent_id: rejects self-parenting, cycles (parent is a descendant), and hierarchies deeper than 32.';

-- Trigger function is invoked by the trigger, never called directly.
revoke all on function private.enforce_org_parent_no_cycle() from public;

create trigger organizations_parent_no_cycle
  before insert or update on public.organizations
  for each row
  execute function private.enforce_org_parent_no_cycle();

-- -----------------------------------------------------------------------------
-- 3. private.auth_user_is_member_of_tree(org_id) -> boolean
-- -----------------------------------------------------------------------------
-- The tree-aware sibling of `private.auth_user_is_member_of`. True when the
-- authenticated user is a member of p_org_id ITSELF, or of ANY ANCESTOR of it.
-- Downward only — being a member of a CHILD of p_org_id is NOT enough.
--
-- Shape deliberately mirrors `auth_user_is_member_of`: SECURITY DEFINER (so it
-- can be called from a policy on `memberships`/`organizations` without recursing
-- back into that policy), STABLE, `set search_path = ''`, fully schema-qualified.
--
-- SOFT DELETES — identical semantics to `auth_user_is_member_of`, which counts a
-- membership only when the MEMBERSHIP and ITS ORGANIZATION are both active. Here
-- that lifts to the chain: the walk traverses only active orgs (a soft-deleted
-- org is not a member of `chain`, so it neither matches nor is walked THROUGH),
-- and each candidate membership must itself be active. So a soft-deleted target
-- org returns false exactly as before, and soft-deleting a mid-tree org detaches
-- the subtree below it from that org's ancestors' inherited access. This only
-- ever NARROWS visibility relative to the flat helper, consistent with
-- 20260610000001_soft_deletes.sql.
--
-- NULL auth.uid() (anon): `m.user_id = auth.uid()` is NULL for every row, so no
-- row matches and EXISTS is false — same as the existing helper.
-- -----------------------------------------------------------------------------
create or replace function private.auth_user_is_member_of_tree(p_org_id uuid)
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
    where m.user_id = auth.uid()
      and m.deleted_at is null
  );
$$;

comment on function private.auth_user_is_member_of_tree(uuid) is 'True when auth.uid() has an active membership in the given organization OR in any of its ancestors (inheritance flows DOWNWARD only; a child org''s member gets no access to the parent). Active-only walk, depth-capped at 32. Tree-aware sibling of auth_user_is_member_of.';

-- Same grant as the existing membership helpers (`anon` never gets USAGE on the
-- private schema, so anon cannot reach this).
grant execute on function private.auth_user_is_member_of_tree(uuid) to authenticated;
