-- =============================================================================
-- Migration: Reshape the Cortex tables to the ORG-TREE model
-- =============================================================================
--
-- The Cortex shell tables (20260714000001) and the first tool table
-- (20260714000002) were built on a model we have since rejected:
--   * a POLYMORPHIC `app_instances.owner_id` (a user id or an org id, depending
--     on `owner_type`), FK-constrained to nothing;
--   * a NULLABLE `org_id` meaning "a personal tool has no org";
--   * `instance_id` on the tool table as the isolation axis.
--
-- The org-tree model (20260716000001) replaces all three. Every user has a
-- PERSONAL ORGANIZATION, so "personal" is just a root org and `org_id` is never
-- null — which kills the polymorphism and the nullable org in one move. Tabs and
-- branches are CHILD ORGANIZATIONS, not instances, so `instance_id` disappears
-- from the tool table entirely; isolation and inheritance both key on `org_id`
-- and flow downward through the tree.
--
-- SAFETY: both tables were verified EMPTY (select count(*) = 0 on app_instances
-- and inventory_items) before this drop/rebuild was written. This migration is
-- destructive by design and is only correct against that empty state — it is a
-- reshape of a model that never carried data, not a data migration.
--
-- -----------------------------------------------------------------------------
-- DEPENDENTS — `events.emitted_by_instance` and `ai_log.target_instance_id`
-- -----------------------------------------------------------------------------
-- Both FK-reference app_instances with ON DELETE SET NULL. Dropping the table
-- CASCADE removes those FK CONSTRAINTS and leaves the COLUMNS behind as plain
-- uuid. The columns are audit metadata and MUST survive — an audit trail that
-- forgets what it pointed at is worthless — so we re-add both constraints after
-- the rebuild with the identical ON DELETE SET NULL behavior. The columns are
-- never dropped, and their indexes (events_emitted_by_instance_idx,
-- ai_log_target_instance_id_idx) live on `events`/`ai_log` and so are untouched
-- by the cascade.
--
-- -----------------------------------------------------------------------------
-- RLS — MEMBERSHIP IS A BLOCKING CONDITION, NEVER AN ALTERNATIVE
-- -----------------------------------------------------------------------------
-- The old policies read `owner_id = auth.uid() OR is_member(org_id)`. That OR is
-- a real hole: a user who authored a row and then LEFT the organization kept
-- reading it forever, because the first branch never re-checks membership. The
-- OR is not reproduced anywhere here. Membership in the row's org tree is an AND
-- — it gates every read, and losing membership loses access, immediately and by
-- construction.
--
-- The check is `private.auth_user_is_member_of_tree(org_id)`: a member of an
-- ANCESTOR org reads its descendants' rows (a parent org sees its branches), a
-- member of a CHILD org reads NOTHING of its parent. Inheritance is downward
-- only, so a branch employee can never read up into head office.
--
-- FAIL-CLOSED VISIBILITY (deliberate, NOT a bug):
-- `inventory_items` rows carry `visibility in ('private','org','restricted')`,
-- but the SELECT policy admits ONLY `visibility = 'org'`. Rows marked 'private'
-- or 'restricted' are therefore readable by NOBODY through the client API until
-- the `record_grants` table lands in a later migration and teaches the policy who
-- may see them. This is chosen deliberately: the alternative — leaving those rows
-- readable "for now" — would ship a permissive default and rely on a future
-- migration to take access away, which is exactly backwards. We fail CLOSED: the
-- rows are inert until the grant model exists to open them precisely. (Writes are
-- service_role-only, so server-side code is unaffected.)
--
-- WRITES remain UNPOLICIED (therefore DENIED) for anon/authenticated on both
-- tables, exactly as before. Cortex writes run server-side as `service_role`
-- through the data-layer, which bypasses RLS. This migration does NOT touch the
-- `events` or `ai_log` policies.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Drop the tool table first (it FK-references app_instances via instance_id).
-- -----------------------------------------------------------------------------
drop table public.inventory_items;

-- -----------------------------------------------------------------------------
-- 2. Drop app_instances. CASCADE removes the two dependent FK CONSTRAINTS on
--    events/ai_log; their columns and indexes survive and are re-linked in 4.
-- -----------------------------------------------------------------------------
drop table public.app_instances cascade;

-- -----------------------------------------------------------------------------
-- 3. Rebuild app_instances — no polymorphism, no nullable org.
-- -----------------------------------------------------------------------------
create table public.app_instances (
  id            uuid primary key default gen_random_uuid(),
  definition_id uuid not null references public.app_definitions (id) on delete cascade,
  owner_id      uuid not null references public.users (id),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  config        jsonb not null default '{}'::jsonb,
  is_pinned     boolean not null default false,
  usage_score   numeric not null default 0,
  last_used_at  timestamptz,
  created_at    timestamptz not null default now()
);

comment on table  public.app_instances             is 'An instance of a tool, always scoped to exactly one organization (a personal instance simply lives in the user''s personal org). Cortex shell table.';
comment on column public.app_instances.owner_id    is 'The user who owns this instance. A real FK to public.users — the previous polymorphic user-or-org id is gone.';
comment on column public.app_instances.org_id      is 'The organization this instance belongs to. NEVER NULL: every user has a personal organization, so there is no org-less instance. Reads inherit DOWN the org tree.';
comment on column public.app_instances.usage_score is 'Denormalized usage weight used for ranking/surfacing tools.';

-- Indexes carried over unchanged: all three columns survive the reshape, and no
-- index referenced the dropped `owner_type`, so none became obsolete. owner_id
-- is now a real FK, so its index also keeps a user delete from seq-scanning.
create index app_instances_definition_id_idx on public.app_instances (definition_id);
create index app_instances_org_id_idx        on public.app_instances (org_id);
create index app_instances_owner_id_idx      on public.app_instances (owner_id);

-- -----------------------------------------------------------------------------
-- 4. Re-link the audit columns the cascade orphaned (same ON DELETE SET NULL).
-- -----------------------------------------------------------------------------
alter table public.events
  add constraint events_emitted_by_instance_fkey
  foreign key (emitted_by_instance) references public.app_instances (id) on delete set null;

alter table public.ai_log
  add constraint ai_log_target_instance_id_fkey
  foreign key (target_instance_id) references public.app_instances (id) on delete set null;

-- -----------------------------------------------------------------------------
-- 5. Rebuild inventory_items — org-scoped, no instance_id, with visibility.
-- -----------------------------------------------------------------------------
create table public.inventory_items (
  id       uuid primary key default gen_random_uuid(),

  -- Isolation is org-only now. Tabs/branches are CHILD ORGS, not instances.
  owner_id uuid not null references public.users (id),
  org_id   uuid not null references public.organizations (id) on delete cascade,

  visibility text not null default 'org'
    check (visibility in ('private', 'org', 'restricted')),

  name              text not null,
  quantity          numeric not null default 0,
  unit              text not null default 'unit',
  reorder_threshold numeric not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table  public.inventory_items            is 'Cortex Inventory tool table. Org-scoped: reads key on org_id and inherit DOWN the org tree. `instance_id` is gone — tabs/branches are child organizations.';
comment on column public.inventory_items.owner_id   is 'The user who created/owns the row. NOT a read grant on its own — membership in the row''s org tree is required regardless.';
comment on column public.inventory_items.org_id     is 'Owning organization. NEVER NULL: personal data lives in the user''s personal org.';
comment on column public.inventory_items.visibility is 'Intended audience: ''org'' (readable by the org tree), ''private'' or ''restricted'' (NOT readable by anyone via RLS until record_grants lands — fail closed by design).';

create index inventory_items_org_id_idx   on public.inventory_items (org_id);
create index inventory_items_owner_id_idx on public.inventory_items (owner_id);

-- -----------------------------------------------------------------------------
-- 6. RLS — SELECT only, fail-closed, membership always a blocking AND.
-- -----------------------------------------------------------------------------
alter table public.app_instances enable row level security;
grant select on public.app_instances to authenticated;

create policy "read app instances in your org tree"
  on public.app_instances
  for select
  to authenticated
  using ( private.auth_user_is_member_of_tree(org_id) );

alter table public.inventory_items enable row level security;
grant select on public.inventory_items to authenticated;

create policy "read org-visible inventory in your org tree"
  on public.inventory_items
  for select
  to authenticated
  using (
    private.auth_user_is_member_of_tree(org_id)
    and visibility = 'org'
  );
