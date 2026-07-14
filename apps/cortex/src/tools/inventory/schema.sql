-- Inventory — tool schema (Cortex-SubApp-Standard.md §2 / §6).
--
-- This is the tool's canonical table definition. The IDENTICAL DDL is shipped as
-- the applied migration
--   packages/db/supabase/migrations/20260714000002_inventory_items.sql
-- (kept in sync). Run it with `supabase db push` from packages/db.
--
-- Every tool table carries the three mandatory fields (instance_id, owner_id,
-- org_id) and enables RLS using the repo's membership helper (a permitted §6
-- deviation over the inline subquery).

create table public.inventory_items (
  id          uuid primary key default gen_random_uuid(),

  -- ===== the three mandatory fields (on every tool table, no exceptions) =====
  instance_id uuid not null references public.app_instances (id) on delete cascade,
  owner_id    uuid not null references public.users (id),
  org_id      uuid references public.organizations (id), -- nullable: a personal tool has no org
  -- ===========================================================================

  name              text not null,
  quantity          numeric not null default 0,
  unit              text not null default 'unit',
  reorder_threshold numeric not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index inventory_items_instance_id_idx on public.inventory_items (instance_id);
create index inventory_items_org_id_idx on public.inventory_items (org_id);

alter table public.inventory_items enable row level security;
grant select on public.inventory_items to authenticated;

-- SELECT: your own rows OR rows in an org you belong to (repo membership helper).
create policy "read own or org inventory"
  on public.inventory_items
  for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    or (org_id is not null and private.auth_user_is_member_of(org_id))
  );

-- WRITE: no client policy → denied for anon/authenticated. Writes go through the
-- Cortex data-layer as service_role (bypasses RLS). §6's owner/manager role check
-- is not expressible here — this repo's `memberships` has no `role` column (roles
-- live in `roles`/`membership_roles`) — so, per ARCHITECTURE.md #27/#11, tool
-- writes stay service_role-only until Cortex auth + a reviewed write policy land.
