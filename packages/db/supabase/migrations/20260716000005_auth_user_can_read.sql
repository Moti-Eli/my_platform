-- =============================================================================
-- Migration: private.auth_user_can_read + wire inventory_items' SELECT policy
-- =============================================================================
--
-- `20260716000002` left `inventory_items` rows marked 'private' or 'restricted'
-- readable by NOBODY, failing CLOSED until the grant model existed. `record_grants`
-- landed in `20260716000004`. This migration is the other half: the read helper
-- that consults it, and the policy rewire that puts it in the path.
--
-- This is an EXTENSION, not a loosening of a working rule. The old policy
-- (`is_member_of_tree(org_id) AND visibility = 'org'`) was correct as far as it
-- went; it simply had no answer for 'private'/'restricted' and so denied them.
-- The new helper keeps the membership AND byte-for-byte and adds the two branches
-- that were missing.
--
-- -----------------------------------------------------------------------------
-- THE SHAPE — membership is a BLOCKING condition, never an alternative
-- -----------------------------------------------------------------------------
--     can_read(row) =
--       is_member_of_tree(org_id)          <- AND. always. blocks first.
--       AND ( visibility = 'org'
--             OR (visibility = 'private'    AND owner_id = auth.uid())
--             OR (visibility = 'restricted' AND a grant exists: user|role|group) )
--
-- `owner_id = auth.uid()` and the grant check appear ONLY inside the parenthesized
-- OR, never at the top level. The old `owner_id = auth.uid() OR is_member(org)`
-- shape was a real bug — the left branch never re-checked membership, so a
-- departed employee kept reading org data forever. It is not reproduced here and
-- must never be reintroduced. Losing membership loses access, by construction.
--
-- Inheritance flows DOWNWARD ONLY (inherited from is_member_of_tree): a member of
-- a parent org reads a child's rows; a member of a child reads nothing of the
-- parent's.
--
-- -----------------------------------------------------------------------------
-- ROW FIELDS ARRIVE AS PARAMETERS — no dynamic SQL, no re-lookup
-- -----------------------------------------------------------------------------
-- The helper takes (table_name, record_id, org_id, owner_id, visibility) as plain
-- arguments rather than fetching the row. The policy already HAS the row in hand,
-- so re-reading it would be a wasted lookup — and looking it up generically would
-- need dynamic SQL, which a STABLE sql function in an RLS policy cannot do. This
-- is the same reasoning that forced `record_grants.org_id` to be denormalized:
-- `table_name` is dynamic, so nothing static can resolve a row from it.
--
-- The cost of parameters is that a CALLER COULD LIE — pass another row's org_id
-- or a visibility the row does not have. That is not a hole here: the only caller
-- is the RLS policy, which passes the row's own columns, and the function is
-- reachable only from the `private` schema (not exposed by PostgREST, anon has no
-- USAGE). A future migration making a tool row's org_id/owner_id/visibility
-- IMMUTABLE is what keeps the passed values honest over the row's lifetime.
--
-- -----------------------------------------------------------------------------
-- WHY (b) AND (c) RE-CHECK deleted_at — LOAD-BEARING, NOT DEFENSIVE NOISE
-- -----------------------------------------------------------------------------
-- `membership_roles` and `group_members` have ON DELETE CASCADE, which fires on
-- HARD delete only. Soft-deleting a membership leaves those rows fully intact —
-- `verify-groups.ts` already proves exactly this for `group_members` (the row
-- survives; only visibility is revoked). So "the user holds this role" cannot be
-- read off `membership_roles` alone: the row outlives the membership that gave it
-- meaning.
--
-- The concrete leak, if (b) omitted the deleted_at checks:
--
--   A user is a member of HQ and holds the role "Regional Manager" there. They
--   are ALSO a direct member of branch C. A restricted row in C is granted to
--   "Regional Manager". They leave HQ — that membership is soft-deleted, but the
--   membership_roles row survives the soft delete.
--
--   Now: is_member_of_tree(C) still returns TRUE, via their direct C membership.
--   The blocking AND does NOT save us — it was never violated. The user is
--   legitimately still in C. Without the deleted_at check, the role grant still
--   matches through the surviving membership_roles row, and they keep reading a
--   row that was granted to an HQ role they no longer hold.
--
-- The same shape applies to (c) via `group_members`. Both checks join back to
-- `memberships` (and `organizations`) and require BOTH to be active, which is the
-- same "a membership counts only if it AND its org are active" rule the soft-delete
-- migration (20260610000001) established for every other helper.
--
-- THE ASYMMETRY WITH (a) — why a user grant needs no such check:
--   A role or group membership is a CLAIM ABOUT A RELATIONSHIP, and a relationship
--   can go stale on its own while the person remains legitimately present. That is
--   precisely the leak above. Identity cannot go stale that way: `subject_user_id
--   = auth.uid()` is a grant to the PERSON, not to a relationship they hold, and
--   `is_member_of_tree` has already proved that person belongs to the row's tree.
--   There is no second fact to re-verify — so (a) needs no further check, and
--   adding one would be cargo cult.
--
-- -----------------------------------------------------------------------------
-- DO NOT USE private.auth_user_can_access_role HERE
-- -----------------------------------------------------------------------------
-- It looks like the function this needs. It is not. It answers "is the user a
-- MEMBER OF THE ROLE'S ORG" (roles -> organization_id -> memberships), NOT "does
-- the user HOLD the role" — it never touches `membership_roles`. Substituting it
-- into branch (b) would turn EVERY ROLE GRANT INTO AN ORG-WIDE GRANT: granting a
-- restricted row to "Regional Manager" would hand it to every member of that org,
-- manager or not. The role-holding check below goes through `membership_roles`
-- deliberately. Do not "simplify" it back to the helper.
--
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER
-- -----------------------------------------------------------------------------
-- Standard shape for our RLS helpers (20260605000002): runs as the owner, which
-- BYPASSES RLS, so reading `record_grants` (sealed: RLS on, no policies, nothing
-- granted to clients) works from inside a policy, and reading `memberships` from
-- a policy does not re-enter that table's own policy. STABLE for planner caching;
-- `set search_path = ''` with every name fully qualified closes the
-- search-path-hijack hole. Lives in `private`, which PostgREST does not expose, so
-- it is not callable as an RPC.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. private.auth_user_can_read(...) -> boolean
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

      or (p_visibility = 'private' and p_owner_id = auth.uid())

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

comment on function private.auth_user_can_read(text, uuid, uuid, uuid, text) is 'Row-level read check for Cortex tool tables. Membership in the row''s org tree is a BLOCKING AND; on top of it, ''org'' is readable by the tree, ''private'' by its owner, ''restricted'' only via a record_grants match (user / held role / joined group). Role and group grants re-check that the backing membership and its org are ACTIVE — those rows survive a soft-deleted membership. Never uses auth_user_can_access_role (that is org-membership, not role-holding).';

-- Same grant as the other membership helpers (`anon` never gets USAGE on the
-- private schema, so anon cannot reach this).
grant execute on function private.auth_user_can_read(text, uuid, uuid, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Rewire inventory_items' SELECT policy onto the helper.
-- -----------------------------------------------------------------------------
-- The old policy is REPLACED, not amended: its name ("read org-visible inventory
-- in your org tree") describes a rule that stops being true here — the policy no
-- longer admits only `visibility = 'org'`. A name that lies about its policy is
-- worse than no name.
--
-- app_instances is deliberately NOT touched: it has no `visibility` column and no
-- per-record grants, so `is_member_of_tree(org_id)` remains exactly right for it.
-- No write policy is added anywhere — Cortex writes stay `service_role`-only.
-- -----------------------------------------------------------------------------
drop policy "read org-visible inventory in your org tree" on public.inventory_items;

create policy "read inventory the user is entitled to"
  on public.inventory_items
  for select
  to authenticated
  using (
    private.auth_user_can_read('inventory_items', id, org_id, owner_id, visibility)
  );
