-- =============================================================================
-- Migration: private.auth_user_can_write + private.auth_user_can_grant
-- =============================================================================
--
-- The other two verbs of the row-level access rule. `auth_user_can_read`
-- (20260716000005) answered "which rows may I see"; these answer "which may I
-- change" and "which may I share".
--
-- -----------------------------------------------------------------------------
-- NOTHING IS WIRED. THESE ARE CREATED UNUSED, ON PURPOSE.
-- -----------------------------------------------------------------------------
-- No policy is added, dropped, or amended by this migration; no table is touched.
-- Both functions are dead code the moment they land, exactly as
-- `auth_user_is_member_of_tree` was when 20260716000001 created it and left every
-- policy calling the flat helper. Adding a capability and putting it in the
-- enforcement path are two different reviews, and the second one is far more
-- dangerous — keeping them apart is what lets each be read on its own.
--
-- `shell.grant_access` consumes `can_grant` in a later step; `can_write` waits on
-- the Cortex write path (writes are `service_role`-only today, so there is no
-- client write policy for it to gate yet).
--
-- -----------------------------------------------------------------------------
-- WHAT THESE DO NOT ANSWER — the permission layer is a separate question
-- -----------------------------------------------------------------------------
-- `can_write` answers WHICH ROW, and only that. Whether the user may write this
-- KIND of thing at all — may they edit inventory? may they manage members? — is
-- the ACTION-LEVEL permission layer (`private.auth_user_has_permission`), and it
-- is deliberately not consulted here. 20260605000002 draws that line explicitly:
-- RLS handles tenant isolation ("is this row in my org?"), while action-level
-- permissions live in @platform/auth and layer on top; mixing them "would couple
-- tenant isolation to business rules and make both harder to reason about".
--
-- The two compose with AND at the CALL SITE:
--
--     private.auth_user_has_permission(org_id, 'inventory.edit')   -- may I edit at all?
--     AND private.auth_user_can_write('inventory_items', id, ...)  -- may I edit THIS row?
--
-- A caller that checks only one of them has a hole. Do not blur the line by
-- folding a permission check in here — that would make every future policy
-- silently depend on a permission key buried inside a row-level helper.
--
-- -----------------------------------------------------------------------------
-- ACCESS IS HIERARCHICAL: grant > write > read
-- -----------------------------------------------------------------------------
-- `record_grants.access` is a single level per (row, subject), not a set of
-- flags, and the levels nest. So:
--   * can_write accepts access IN ('write', 'grant') — a 'grant' holder can
--     obviously also write; a 'read' grant confers NO write.
--   * can_grant accepts access = 'grant' ONLY — 'write' does not confer granting.
--     Being able to change a row is not the same as being able to widen who else
--     can see it; the second is how a leak spreads, so it is its own level.
-- Read is the floor: every level implies it. Nothing here re-derives can_read.
--
-- -----------------------------------------------------------------------------
-- WHY can_grant IS NARROWER — this is NOT an omission
-- -----------------------------------------------------------------------------
-- can_write mirrors can_read's shape (org / private-owner / restricted-grant).
-- can_grant deliberately does NOT: it has NO 'org' branch and NO owner branch. It
-- is `is_member_of_tree AND visibility = 'restricted' AND a 'grant'-level grant`.
-- Each missing branch is a decision:
--
--   * visibility = 'org' — the ENTIRE org tree already reads the row. A grant on
--     it confers nothing on anybody; it cannot widen access that is already as
--     wide as the tree. Permitting it would only mint no-op rows in a security
--     table — rows an auditor must read, reason about, and discover mean nothing.
--     record_grants is small and every row in it should matter.
--
--   * visibility = 'private' — a grant on a private row can NEVER fire, for
--     anyone. Look at can_read: its private branch is `p_owner_id = auth.uid()`
--     and there is no grant branch beside it, so no grant is ever consulted for a
--     private row. Allowing can_grant here would let someone write grant rows that
--     are dead on arrival. Nor is "grant it, then flip it to restricted" a route:
--     a later migration makes `visibility` IMMUTABLE, so a private row cannot be
--     upgraded to shareable after the fact. A row meant to be shared is BORN
--     restricted — the tool decides at creation time, not the user afterwards.
--
--   * The BOOTSTRAP question ("who writes the first grant, if granting requires a
--     grant?") is answered outside this function: the shell writes it as
--     `service_role` from the manifest's `defaultGrants` when the row is created —
--     which is also why a restricted row's owner is not stranded, and why
--     can_read's owner-cannot-read-their-own-ungranted-restricted-row behavior is
--     correct rather than a trap. can_grant governs HUMANS re-granting an existing
--     restricted row. It does not govern creation.
--
-- -----------------------------------------------------------------------------
-- THE deleted_at CHECKS IN THE ROLE/GROUP BRANCHES ARE LOAD-BEARING
-- -----------------------------------------------------------------------------
-- Both functions reuse can_read's grant-matching sub-structure verbatim,
-- including the `m.deleted_at is null` / `o.deleted_at is null` checks in the role
-- and group branches. The full reasoning is in 20260716000005's header and is not
-- repeated here; the short version: `membership_roles` and `group_members` cascade
-- on HARD delete only, so they survive a soft-deleted membership. A user who
-- leaves HQ but keeps a direct branch membership still passes is_member_of_tree —
-- the blocking AND does not save you — and would keep writing/granting rows
-- granted to the HQ role they no longer hold. Do not drop these checks.
--
-- The user branch needs no such check, for the same asymmetry documented there: a
-- role or group membership is a claim that can go stale on its own; identity
-- cannot.
--
-- The three-branch matcher is now duplicated across can_read/can_write/can_grant.
-- That is tolerated at three copies because each function's shape differs around
-- it and the copies are reviewed together; if a fourth verb appears, factor the
-- matcher into its own `private.` helper rather than adding a fourth copy.
--
-- Both functions keep can_read's five-parameter signature, so the three verbs are
-- callable interchangeably from a policy. `can_grant` does not read `p_owner_id`
-- (it has no owner branch, by the reasoning above) — the parameter is kept for
-- signature symmetry, not overlooked.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. private.auth_user_can_write(...) -> boolean
-- -----------------------------------------------------------------------------
create or replace function private.auth_user_can_write(
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
    -- BLOCKS FIRST. Never an OR branch.
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
            -- Hierarchical: 'grant' implies 'write'. A 'read' grant does not.
            and rg.access in ('write', 'grant')
            and (
              -- (a) Granted to the PERSON. Identity does not go stale.
              rg.subject_user_id = auth.uid()

              -- (b) Granted to a ROLE THE USER HOLDS (membership_roles), with the
              --     membership and its org still ACTIVE. Load-bearing.
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

              -- (c) Granted to a GROUP THE USER IS IN, same activeness rule.
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

comment on function private.auth_user_can_write(text, uuid, uuid, uuid, text) is 'Row-level WRITE check for Cortex tool tables. Same shape as auth_user_can_read, but the restricted branch requires access IN (''write'',''grant'') — a ''read'' grant confers no write. Answers WHICH ROW only; whether the user may write this KIND of thing is auth_user_has_permission, composed with AND at the call site.';

grant execute on function private.auth_user_can_write(text, uuid, uuid, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. private.auth_user_can_grant(...) -> boolean
-- -----------------------------------------------------------------------------
-- NARROWER BY DESIGN: restricted rows only, 'grant'-level only, no owner branch.
-- See the header — every missing branch is a decision, not an oversight.
-- -----------------------------------------------------------------------------
create or replace function private.auth_user_can_grant(
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
    -- BLOCKS FIRST.
    private.auth_user_is_member_of_tree(p_org_id)

    -- Only a restricted row has anything to grant. 'org' is already tree-wide (a
    -- grant would be a no-op row); 'private' has no grant branch in can_read, so a
    -- grant on it could never fire. No owner branch: owning a row is not a licence
    -- to widen it — the shell's defaultGrants seed the first grant as service_role.
    and p_visibility = 'restricted'

    and exists (
      select 1
      from public.record_grants rg
      where rg.table_name = p_table_name
        and rg.record_id = p_record_id
        -- 'grant' ONLY. 'write' does not confer granting: changing a row and
        -- widening who can see it are different powers.
        and rg.access = 'grant'
        and (
          -- (a) Granted to the PERSON. Identity does not go stale.
          rg.subject_user_id = auth.uid()

          -- (b) Granted to a ROLE THE USER HOLDS, membership + org still ACTIVE.
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

          -- (c) Granted to a GROUP THE USER IS IN, same activeness rule.
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
    );
$$;

comment on function private.auth_user_can_grant(text, uuid, uuid, uuid, text) is 'Row-level RE-GRANT check for Cortex tool tables. Narrower than can_read/can_write ON PURPOSE: restricted rows only (an ''org'' row is already tree-wide; a ''private'' row has no grant branch that could ever fire), ''grant''-level grants only (''write'' does not confer granting), and NO owner branch (the shell seeds the first grant as service_role from defaultGrants). Governs humans re-granting, not creation.';

grant execute on function private.auth_user_can_grant(text, uuid, uuid, uuid, text) to authenticated;
