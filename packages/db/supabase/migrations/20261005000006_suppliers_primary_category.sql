-- =============================================================================
-- Migration: primary category on public.suppliers (orders tool, stage 2)
-- =============================================================================
--
-- Primary category on a supplier: the supplier shows up in that category right
-- away, even before it has any products — so a restaurant can enter all its
-- suppliers at once and fill in products at its own pace. The category on each
-- PRODUCT is unchanged — a supplier still also appears in every category it has
-- products in.
--
-- NULLABLE in the DB because suppliers already exist; "required" is enforced by
-- the app (form + the orders.create_supplier intent schema), not by the table.
--
-- Same-org guarantee via a COMPOSITE foreign key to order_categories (id,
-- org_id), like supplier_products (20261005000005). A NULL primary_category_id
-- skips the check (MATCH SIMPLE), so existing suppliers are unaffected.
--
-- ON DELETE RESTRICT (agreed): deleting a category that is still some supplier's
-- primary category is refused. SET NULL was rejected on purpose — it would make
-- those suppliers vanish from the category navigation, the very problem this
-- column solves. Reassign the suppliers first, then delete the category.
--
-- Touches public.suppliers (one column, one FK, one index). No policy, grant or
-- function changes.
-- =============================================================================

alter table public.suppliers
  add column primary_category_id uuid;

alter table public.suppliers
  add constraint suppliers_primary_category_fk
    foreign key (primary_category_id, org_id)
    references public.order_categories (id, org_id)
    on delete restrict;

create index suppliers_primary_category_id_idx
  on public.suppliers (primary_category_id)
  where primary_category_id is not null;

comment on column public.suppliers.primary_category_id is
  'The supplier''s primary category — makes it visible in that category even with no products. NULL for suppliers created before this column; required by the app on create/edit, not by the DB.';
