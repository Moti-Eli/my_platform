-- =============================================================================
-- Migration: The Cortex `orders` tool — `supplier_products` table (stage 2)
-- =============================================================================
--
-- A supplier's product catalog. The CATEGORY sits on the PRODUCT, not on the
-- supplier: a supplier selling cheese and vegetables appears under both
-- categories, with a different product list in each.
--
-- Security model identical to public.suppliers (20261005000001) — orders.access
-- on every policy, immutability trigger from birth. No new function.
--
-- -----------------------------------------------------------------------------
-- SAME-ORG GUARANTEE — COMPOSITE FOREIGN KEYS
-- -----------------------------------------------------------------------------
-- (supplier_id, org_id) → suppliers (id, org_id) and (category_id, org_id) →
-- order_categories (id, org_id): the database refuses a product whose supplier
-- or category lives in another org (see 20261005000003). Consequence, by
-- design: a supplier, its categories and its products all live in ONE org.
--
-- -----------------------------------------------------------------------------
-- DELETE BEHAVIOUR — AND A COMMITMENT FOR STAGE 3
-- -----------------------------------------------------------------------------
-- * Deleting a SUPPLIER cascades to its products. Acceptable in stage 2 only
--   because products carry no history yet.
-- * Deleting a CATEGORY that still has products is REFUSED (restrict).
--
-- STAGE 3 MUST (agreed, do not drop): once `orders` exists, orders.supplier_id
-- references suppliers with ON DELETE RESTRICT — a supplier with orders can NOT
-- be deleted — and suppliers gains an `archived boolean not null default false`
-- column with an "archive" action in the UI replacing delete for such suppliers.
-- Products in past orders are archived (`archived` below), never deleted.
--
-- -----------------------------------------------------------------------------
-- default_unit AND price
-- -----------------------------------------------------------------------------
-- `default_unit` holds a unit KEY from the code-side list (kg, pack, carton…).
-- Deliberately NOT a CHECK/enum: adding a unit must not need a migration.
-- `price` is RESERVED for the supplier-built catalog: nullable, never written or
-- shown by the app today; present so that step needs no migration.
--
-- Does NOT touch anon or service_role. Touches no other table.
-- =============================================================================

create table public.supplier_products (
  id uuid primary key default gen_random_uuid(),

  owner_id uuid not null references public.users (id),
  org_id   uuid not null references public.organizations (id) on delete cascade,

  visibility text not null default 'org'
    check (visibility in ('private', 'org', 'restricted')),

  supplier_id uuid not null,
  category_id uuid not null,

  name text not null
    check (char_length(name) between 1 and 200),

  -- Unit KEY from the code-side list (kg, pack, carton…). Deliberately NOT a
  -- CHECK/enum: adding a unit must not need a migration. '' = no default unit.
  default_unit text not null default ''
    check (char_length(default_unit) <= 30),

  -- Reserved for the supplier-built catalog. Not written or shown today.
  price numeric(10,2)
    check (price >= 0),

  archived boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Same-org guarantees: a product can only point at a supplier / category in
  -- ITS OWN org. Deleting a supplier removes its products; deleting a category
  -- that still has products is refused.
  constraint supplier_products_supplier_fk
    foreign key (supplier_id, org_id)
    references public.suppliers (id, org_id) on delete cascade,
  constraint supplier_products_category_fk
    foreign key (category_id, org_id)
    references public.order_categories (id, org_id) on delete restrict,

  -- Target for order_items' composite FK in stage 3.
  constraint supplier_products_id_org_id_key unique (id, org_id),
  -- One product name per supplier.
  constraint supplier_products_supplier_name_key unique (supplier_id, name)
);

comment on table  public.supplier_products              is 'Cortex Orders tool — a supplier''s product catalog. Category sits on the product. Same-org with its supplier and category (composite FKs). Every policy additionally requires orders.access.';
comment on column public.supplier_products.owner_id     is 'The user who created the product. Frozen after insert.';
comment on column public.supplier_products.org_id       is 'Owning organization — must equal the supplier''s and the category''s (composite FKs). Frozen after insert.';
comment on column public.supplier_products.supplier_id  is 'The supplier selling this product. Deleting the supplier deletes its products (stage 2 only — see header).';
comment on column public.supplier_products.category_id  is 'The product''s category. A category with products cannot be deleted.';
comment on column public.supplier_products.name         is 'Product name (1–200 chars, unique per supplier).';
comment on column public.supplier_products.default_unit is 'Unit KEY suggested when ordering (code-side list, not a DB enum). '''' = none.';
comment on column public.supplier_products.price        is 'RESERVED for the supplier-built catalog. NULL; not written or shown by the app today.';
comment on column public.supplier_products.archived     is 'Hidden from the catalog but kept for past orders. Archive, never delete, once a product has order history.';

create index supplier_products_org_id_idx      on public.supplier_products (org_id);
create index supplier_products_owner_id_idx    on public.supplier_products (owner_id);
create index supplier_products_category_id_idx on public.supplier_products (category_id);
-- (supplier_id is already indexed by the leading column of supplier_name_key.)

alter table public.supplier_products enable row level security;

grant select, insert, update, delete on public.supplier_products to authenticated;

create policy "read supplier products the user is entitled to"
  on public.supplier_products for select to authenticated
  using (
    private.auth_user_can_read('supplier_products', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'orders.access')
  );

create policy "insert supplier products you may write"
  on public.supplier_products for insert to authenticated
  with check (
    private.auth_user_can_write('supplier_products', id, org_id, owner_id, visibility)
    and owner_id = (select auth.uid())
    and private.auth_user_has_permission(org_id, 'orders.access')
  );

create policy "update supplier products you may write"
  on public.supplier_products for update to authenticated
  using (
    private.auth_user_can_write('supplier_products', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'orders.access')
  )
  with check (
    private.auth_user_can_write('supplier_products', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'orders.access')
  );

create policy "delete supplier products you may write"
  on public.supplier_products for delete to authenticated
  using (
    private.auth_user_can_write('supplier_products', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'orders.access')
  );

create trigger supplier_products_immutable_fields
  before update on public.supplier_products
  for each row
  execute function private.enforce_tool_row_immutability();
