-- =============================================================================
-- Migration: Groups + group members (Cortex shell)
-- =============================================================================
--
-- Adds `groups` (a named collection of people inside ONE organization) and
-- `group_members` (the join between a group and a user). Both are Cortex shell
-- tables, so they use `org_id` — matching `app_instances` / `inventory_items` —
-- rather than the core RBAC tables' `organization_id`.
--
-- These are NOT roles. A group carries no permissions; it is an addressing
-- primitive (who to notify, who a record is shared with, who is on a shift).
-- Permissions continue to flow only through `membership_roles`.
--
-- -----------------------------------------------------------------------------
-- SAME-ORG INTEGRITY (enforced at the DB level — DO NOT weaken)
-- -----------------------------------------------------------------------------
-- A group belongs to an organization, and so does a membership. Adding a user to
-- a group MUST NOT be possible unless that user is actually a member of that
-- group's organization. If it were, a group in org A could quietly contain a
-- stranger from org B: every downstream feature that treats "in the group" as
-- "one of us" — notifications, shares, mentions — would leak across tenants. We
-- refuse to rely on application code for this; tenant isolation is enforced by
-- the schema.
--
--   The mechanism (identical to `membership_roles`, 20260605000001): this table
--   carries a single `org_id`, and each of the two foreign keys is COMPOSITE —
--   (group_id, org_id) must match a real (groups.id, groups.org_id) pair, and
--   (user_id, org_id) must match a real (memberships.user_id,
--   memberships.organization_id) pair. Because the SAME org_id value feeds both
--   FKs, the group and the user's membership are forced to share it. A
--   mismatched pair has no valid parent row and the insert fails. (Column names
--   need not match across a composite FK — only the types and the referenced
--   unique constraint do.)
--
-- -----------------------------------------------------------------------------
-- HARD DELETE — no `deleted_at`
-- -----------------------------------------------------------------------------
-- Following the precedent set in 20260610000001_soft_deletes.sql: the join
-- tables (`role_permissions`, `membership_roles`) and `roles` stay hard-delete —
-- "their history rides on the soft-deleted parent". `groups` and `group_members`
-- are the same shape: their history rides on the soft-deleted organization or
-- membership. Deleting a group is a genuine removal, not an offboarding event.
--
-- SOFT-DELETING A MEMBERSHIP therefore LEAVES its `group_members` rows in place
-- (the FK fires on hard delete only) — which is correct: the row is retained for
-- history exactly like the membership it hangs off. Access does not survive it,
-- though: `auth_user_is_member_of_tree` counts only ACTIVE memberships, so an
-- offboarded user immediately stops seeing the org's groups. Re-adding them
-- (clearing `deleted_at`) restores the group membership as it was.
--
-- -----------------------------------------------------------------------------
-- RLS — MEMBERSHIP IS A BLOCKING CONDITION, NEVER AN ALTERNATIVE
-- -----------------------------------------------------------------------------
-- SELECT is gated by `private.auth_user_is_member_of_tree(org_id)` — a member of
-- an ANCESTOR org reads its descendants' groups (head office sees a branch's
-- groups), a member of a CHILD org reads NOTHING of its parent. Inheritance is
-- downward only. There is deliberately no `created_by = auth.uid() OR ...`
-- branch: an OR like that lets a departed member keep reading forever, because
-- it never re-checks membership. Membership is an AND, always.
--
-- WRITES remain UNPOLICIED (therefore DENIED) for anon/authenticated, exactly as
-- on every other Cortex table. Group management runs server-side as
-- `service_role` through the shell's data-layer, which bypasses RLS.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. groups — a named collection of people within ONE organization.
-- -----------------------------------------------------------------------------
create table public.groups (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  -- Group names are unique within an organization (but may repeat across orgs).
  constraint groups_org_name_unique unique (org_id, name),
  -- Composite key target so group_members can reference (id, org_id) together
  -- and thereby pin a group to its organization. Required by the same-org
  -- integrity mechanism described in the header.
  constraint groups_id_org_unique unique (id, org_id)
);

comment on table  public.groups         is 'A named collection of people inside one organization. Carries NO permissions — an addressing primitive, not a role. Cortex shell table.';
comment on column public.groups.org_id  is 'The organization that owns this group. Reads inherit DOWN the org tree.';
comment on column public.groups.name    is 'Group display name, unique within the organization.';

-- FK index for "list all groups in an org" and join performance.
create index groups_org_id_idx on public.groups (org_id);

-- -----------------------------------------------------------------------------
-- 2. group_members — which users are in which group.
-- -----------------------------------------------------------------------------
create table public.group_members (
  group_id   uuid not null,
  user_id    uuid not null,
  -- The shared organization both parents must agree on. Pinned by the two
  -- composite foreign keys below; it always equals the org of the group AND the
  -- org of the user's membership.
  org_id     uuid not null,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id),
  -- Composite FK 1: the group must exist AND belong to org_id.
  constraint group_members_group_fk
    foreign key (group_id, org_id)
    references public.groups (id, org_id) on delete cascade,
  -- Composite FK 2: the user must have a membership in the SAME org_id.
  constraint group_members_membership_fk
    foreign key (user_id, org_id)
    references public.memberships (user_id, organization_id) on delete cascade
);

comment on table  public.group_members         is 'Join table: the users in each group. Composite FKs guarantee the group and the user''s membership share one organization — a user cannot be added to a group in an org they are not a member of.';
comment on column public.group_members.org_id  is 'The organization shared by both the group and the user''s membership. Enforced equal to both parents via composite foreign keys.';

-- The PK indexes (group_id, user_id) — efficient for "members of a group", and
-- it also covers the group composite FK (which leads with group_id). Add the
-- reverse index for "which groups is user X in", plus an org-scoped index that
-- backs the RLS reads and the membership composite FK's delete check.
create index group_members_user_id_idx on public.group_members (user_id);
create index group_members_org_id_idx  on public.group_members (org_id);

-- -----------------------------------------------------------------------------
-- 3. RLS — SELECT only; writes unpolicied and therefore denied.
-- -----------------------------------------------------------------------------
alter table public.groups enable row level security;
grant select on public.groups to authenticated;

create policy "read groups in your org tree"
  on public.groups
  for select
  to authenticated
  using ( private.auth_user_is_member_of_tree(org_id) );

alter table public.group_members enable row level security;
grant select on public.group_members to authenticated;

create policy "read group members in your org tree"
  on public.group_members
  for select
  to authenticated
  using ( private.auth_user_is_member_of_tree(org_id) );
