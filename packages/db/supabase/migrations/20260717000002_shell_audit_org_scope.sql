-- =============================================================================
-- Migration: org-scope the shell audit tables (events, ai_log) + fix a LIVE bug
-- =============================================================================
--
-- Three things, all on the two shell AUDIT tables:
--   1. events.org_id becomes NOT NULL.
--   2. ai_log gains org_id (NOT NULL).
--   3. Both SELECT policies are rebuilt on the org tree — which CLOSES A BYPASS
--      THAT IS LIVE ON THE REMOTE RIGHT NOW.
--
-- SAFETY: both tables were verified EMPTY (select count(*) = 0 on events and
-- ai_log) before this was written. The NOT NULL alters are only correct against
-- that state — `events.org_id` has existing NULLs semantics and `ai_log.org_id`
-- has no default, so either would fail loudly on a non-empty table rather than
-- corrupt anything. This is a reshape of tables that never carried data.
--
-- -----------------------------------------------------------------------------
-- THE LIVE BUG — events' SELECT policy (this is the reason this migration exists)
-- -----------------------------------------------------------------------------
-- The policy shipped in 20260714000001 and is still in force:
--
--     user_id = (select auth.uid())
--     or (org_id is not null and private.auth_user_is_member_of(org_id))
--
-- The LEFT BRANCH BYPASSES MEMBERSHIP ENTIRELY. A user who emitted events in an
-- organization and has since LEFT it keeps reading those rows forever, because
-- `user_id = auth.uid()` never re-checks whether they still belong anywhere. And
-- events are not innocuous: `payload` carries that organization's data — the very
-- thing the emit was about. So the departed employee keeps a live feed of the
-- payloads they used to touch.
--
-- This is the SAME DEFECT step 3 (20260716000002) removed from `inventory_items`
-- and `app_instances`, whose header names it exactly: "a user who authored a row
-- and then LEFT the organization kept reading it forever, because the first branch
-- never re-checks membership". That migration explicitly stated it "does NOT touch
-- the `events` or `ai_log` policies" — scoped deliberately, but the defect was left
-- behind and never followed up. It has been live since. This is the follow-up.
--
-- The replacement has NO OR:
--
--     private.auth_user_is_member_of_tree(org_id)
--
-- Membership is a BLOCKING condition, never an alternative. This preserves the
-- original intent — any member of the event's org may read the org's events, which
-- is what an event BUS is for; events were never private to their emitter — while
-- removing the branch that outlived membership. It also upgrades the check to the
-- tree helper, matching every other Cortex table: a member of an ANCESTOR org reads
-- a descendant's events (head office sees a branch's activity), a member of a CHILD
-- org reads nothing of its parent's. Inheritance is downward only.
--
-- Note what the NOT NULL on org_id does for this policy: with a nullable org_id,
-- `is_member_of_tree(NULL)` is false, so an org-less event would have become
-- readable by NOBODY — the OR was the only thing making such rows visible. Making
-- org_id NOT NULL is what lets the OR go without stranding rows. The two halves of
-- this migration depend on each other.
--
-- -----------------------------------------------------------------------------
-- ai_log.org_id — audit is ORG-SCOPED
-- -----------------------------------------------------------------------------
-- ai_log had no org_id at all, so its policy could only ever be "your own rows".
-- An audit trail that only its own subject can read is not an audit trail: the
-- point of logging who ran what is that SOMEONE ELSE can review it. Adding org_id
-- is what makes org-scoped review expressible at all.
--
-- WHAT THIS MIGRATION DOES **NOT** DO — and this is deliberate:
--
--     ai_log's new policy is a STRICT PREFIX of the final rule, not the final rule.
--
--     today:  is_member_of_tree(org_id) AND user_id = auth.uid()
--     later:  is_member_of_tree(org_id) AND ( user_id = auth.uid()
--                                             OR private.auth_user_has_permission(org_id, 'audit.view') )
--
-- The right-hand side gets extended once the permission vocabulary is settled.
-- Seeding an `audit.view` permission NOW would create vocabulary BEFORE step 5 —
-- the migration that splits `members.manage` / `members.manage_admins` and deletes
-- `users.view` — has finalized it. The roadmap is explicit that ordering: step 5
-- must precede anything that seeds roles/permissions, or the new key needs a data
-- migration over rows that already reference it. So the narrow rule ships now and
-- widens later; a strict prefix can be widened safely, whereas shipping the wrong
-- key and taking it back cannot.
--
-- WHAT IT DOES CHANGE TODAY: a user who leaves an organization stops reading even
-- THEIR OWN ai_log rows for it. The org retains the record; the person loses
-- access. That is not a side effect — it is the blocking-membership rule applied
-- consistently. Audit rows describe what happened INSIDE an org, and access to an
-- org's history is a property of belonging to it, not of having been there once.
--
-- -----------------------------------------------------------------------------
-- SCOPE
-- -----------------------------------------------------------------------------
-- app_definitions is NOT touched: it is the global catalog, `using (true)` is
-- correct for it, and it has no org to scope to. app_instances is NOT touched:
-- step 3 already rebuilt its policy on is_member_of_tree correctly. No my-platform
-- table is touched. No write policy is added anywhere — shell writes remain
-- service_role-only.
--
-- GRANTS: 20260717000001 tightened client grants on inventory_items /
-- app_instances / groups / group_members but did NOT cover events and ai_log.
-- Verified against the live database: both still hand anon AND authenticated
-- DELETE,INSERT,SELECT,UPDATE (inherited from the postgres-owned default, despite
-- 20260714000001's header claiming "anon is granted nothing" — it was never true).
-- The same tightening is applied to them here, matching that migration exactly.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. events.org_id — NOT NULL.
-- -----------------------------------------------------------------------------
-- The existing FK (references public.organizations (id) on delete cascade) and the
-- existing index (events_org_id_idx) are kept as-is; only nullability changes.
alter table public.events
  alter column org_id set not null;

-- The old comment said "NULL for a personal-context event". That is now false:
-- every user has a PERSONAL ORGANIZATION (20260716000002), so there is no
-- org-less context to represent — "personal" is just a root org.
comment on column public.events.org_id is 'The organization the event was emitted in (ctx.orgId). NEVER NULL: every user has a personal organization, so there is no org-less context. Reads inherit DOWN the org tree.';

-- -----------------------------------------------------------------------------
-- 2. ai_log.org_id — new, NOT NULL.
-- -----------------------------------------------------------------------------
alter table public.ai_log
  add column org_id uuid not null references public.organizations (id) on delete cascade;

comment on column public.ai_log.org_id is 'The organization the call was made in (ctx.orgId). Audit is ORG-SCOPED: a log only its own subject can read is not an audit trail. NEVER NULL — personal calls happen in the user''s personal org.';

-- Index the FK: backs the org-scoped policy read, and stops an org delete from
-- seq-scanning the audit trail to service the cascade.
create index ai_log_org_id_idx on public.ai_log (org_id);

-- -----------------------------------------------------------------------------
-- 3. events' SELECT policy — drop the OR, move to the tree.
-- -----------------------------------------------------------------------------
-- Replaced rather than amended: the old name ("read own or org events") describes
-- the very branch being removed.
drop policy "read own or org events" on public.events;

create policy "read events in your org tree"
  on public.events
  for select
  to authenticated
  using ( private.auth_user_is_member_of_tree(org_id) );

-- -----------------------------------------------------------------------------
-- 4. ai_log's SELECT policy — org tree AND your own rows (a strict prefix).
-- -----------------------------------------------------------------------------
-- See the header: the right-hand side widens to include an `audit.view` permission
-- check AFTER step 5 settles the permission vocabulary. Until then, own-rows-only.
drop policy "read own ai log" on public.ai_log;

create policy "read your own ai log in your org tree"
  on public.ai_log
  for select
  to authenticated
  using (
    private.auth_user_is_member_of_tree(org_id)
    and user_id = (select auth.uid())
  );

-- -----------------------------------------------------------------------------
-- 5. Grants — the same tightening 20260717000001 applied to the other Cortex
--    tables. These two were not covered by it.
-- -----------------------------------------------------------------------------
-- `authenticated` keeps SELECT (the policies above depend on it; RLS filters rows,
-- it does not grant table privileges). service_role is untouched — it is the only
-- write path (the data-layer appends every event and audit row).
revoke insert, update, delete on
  public.events,
  public.ai_log
from anon, authenticated;

-- anon loses everything: both policies are `to authenticated`, so anon already
-- received zero rows. This makes that a privilege boundary rather than a
-- consequence of how the policies happen to be scoped.
revoke all on
  public.events,
  public.ai_log
from anon;
