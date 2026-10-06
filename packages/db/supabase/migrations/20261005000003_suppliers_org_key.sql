-- =============================================================================
-- Migration: composite (id, org_id) key on public.suppliers
-- =============================================================================
--
-- Exposes the (supplier, org) PAIR as a foreign-key target, so child tables of
-- the orders tool (supplier_products now, orders in stage 3) can reference it
-- with a COMPOSITE foreign key and the database itself refuses a link across
-- orgs. RLS checks each row on its own org only; without this, a member of two
-- orgs could attach a product in org A to a supplier in org B.
--
-- `id` is already the primary key, so the pair is trivially unique: no existing
-- row can violate this, and nothing about what may be stored changes. org_id is
-- frozen after insert by the immutability trigger, so the pair holds still.
--
-- Touches ONLY public.suppliers (one constraint). No policy, grant or function.
-- =============================================================================

alter table public.suppliers
  add constraint suppliers_id_org_id_key unique (id, org_id);
