-- =============================================================================
-- Migration: Cortex Inventory tool — `inventory_items` table — ADDITIVE
-- =============================================================================
--
-- The FIRST Cortex tool table (Cortex-SubApp-Standard.md §2 / §6). Additive —
-- touches no existing table. Mirrors apps/cortex/src/tools/inventory/schema.sql
-- (kept in sync).
--
-- Carries the three mandatory tool fields (instance_id, owner_id, org_id),
-- indexes on the isolation fields, and RLS built on the existing recursion-safe
-- membership helper `private.auth_user_is_member_of` (a permitted §6 deviation
-- over the inline subquery).
--
-- WRITE POLICY — deliberate: none for anon/authenticated (so client writes are
-- denied). Cortex tool writes run server-side through the data-layer as
-- `service_role` (bypasses RLS). §6's `role in ('owner','manager')` check is NOT
-- expressible in this repo — `public.memberships` has no `role` column (roles
-- live in `roles`/`membership_roles` with `is_admin`) — so, consistent with
-- ARCHITECTURE.md #27/#11 (open writes one reviewed path at a time), a
-- permission-checked tool write policy is deferred until Cortex auth is wired.
-- `service_role` keeps full DML via the default privileges from migration
-- 20260608000002 (which also covers future tables).
-- =============================================================================

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

comment on table  public.inventory_items             is 'Cortex Inventory tool table. Org/instance-scoped; carries the three mandatory tool fields (Standard §6).';
comment on column public.inventory_items.instance_id is 'The app_instances row this data belongs to (tool instance isolation).';
comment on column public.inventory_items.owner_id    is 'The user who owns the row (mirrors auth.uid()).';
comment on column public.inventory_items.org_id      is 'Owning organization; NULL for a personal instance.';

create index inventory_items_instance_id_idx on public.inventory_items (instance_id);
create index inventory_items_org_id_idx on public.inventory_items (org_id);

alter table public.inventory_items enable row level security;
grant select on public.inventory_items to authenticated;

create policy "read own or org inventory"
  on public.inventory_items
  for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    or (org_id is not null and private.auth_user_is_member_of(org_id))
  );

-- =============================================================================
-- WRITES are intentionally UNPOLICIED (therefore DENIED) for anon/authenticated.
-- Tool writes run server-side as service_role via the Cortex data-layer. A
-- permission-checked write policy arrives with Cortex auth (see header).
-- =============================================================================
