-- =============================================================================
-- Migration: The Cortex `orders` tool — `order_categories` table (stage 2)
-- =============================================================================
--
-- Restaurant-defined product categories (cheeses, vegetables, meats…) — the top
-- level of the orders tool's navigation: categories → suppliers in a category →
-- that supplier's products. A TABLE, not a code list, so each restaurant can add
-- its own categories without a migration.
--
-- Security model identical to public.suppliers (20261005000001): read via
-- auth_user_can_read, write via auth_user_can_write, owner pinned on INSERT,
-- every policy ANDed with the tool-wide `orders.access` permission (admins only
-- for now), immutability trigger attached from birth. No new function.
--
-- (id, org_id) is unique so supplier_products can reference a category with a
-- COMPOSITE foreign key — the same-org guarantee described in 20261005000003.
--
-- Does NOT touch anon or service_role. Touches no other table.
-- =============================================================================

create table public.order_categories (
  id uuid primary key default gen_random_uuid(),

  owner_id uuid not null references public.users (id),
  org_id   uuid not null references public.organizations (id) on delete cascade,

  visibility text not null default 'org'
    check (visibility in ('private', 'org', 'restricted')),

  name     text not null
    check (char_length(name) between 1 and 100),
  position integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Target for products' composite FK (same-org guarantee).
  constraint order_categories_id_org_id_key unique (id, org_id),
  -- No two categories with the same name in one org.
  constraint order_categories_org_name_key unique (org_id, name)
);

comment on table  public.order_categories          is 'Cortex Orders tool — restaurant-defined product categories. Org-scoped; every policy additionally requires orders.access.';
comment on column public.order_categories.owner_id is 'The user who created the category. Frozen after insert.';
comment on column public.order_categories.org_id   is 'Owning organization. NEVER NULL. Frozen after insert.';
comment on column public.order_categories.name     is 'Category display name, chosen by the restaurant (1–100 chars, unique per org).';
comment on column public.order_categories.position is 'Display order. 0 for all today (sorted by name); reserved for manual reordering.';

create index order_categories_owner_id_idx on public.order_categories (owner_id);
-- (org_id is already indexed by the leading column of org_name_key.)

alter table public.order_categories enable row level security;

grant select, insert, update, delete on public.order_categories to authenticated;

create policy "read order categories the user is entitled to"
  on public.order_categories for select to authenticated
  using (
    private.auth_user_can_read('order_categories', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'orders.access')
  );

create policy "insert order categories you may write"
  on public.order_categories for insert to authenticated
  with check (
    private.auth_user_can_write('order_categories', id, org_id, owner_id, visibility)
    and owner_id = (select auth.uid())
    and private.auth_user_has_permission(org_id, 'orders.access')
  );

create policy "update order categories you may write"
  on public.order_categories for update to authenticated
  using (
    private.auth_user_can_write('order_categories', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'orders.access')
  )
  with check (
    private.auth_user_can_write('order_categories', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'orders.access')
  );

create policy "delete order categories you may write"
  on public.order_categories for delete to authenticated
  using (
    private.auth_user_can_write('order_categories', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'orders.access')
  );

create trigger order_categories_immutable_fields
  before update on public.order_categories
  for each row
  execute function private.enforce_tool_row_immutability();
