-- =============================================================================
-- Migration: The Cortex `orders` tool — `suppliers` table (stage 1 of 4)
-- =============================================================================
--
-- First table of the `orders` tool (restaurant supplier ordering). Later stages
-- add a per-supplier product catalog, orders/order lines, and WhatsApp sending;
-- this migration is suppliers ONLY.
--
-- Structure follows candidate_answers (20260727000001) — the modern tool-table
-- template: SELECT via `private.auth_user_can_read`, writes via
-- `private.auth_user_can_write`, owner pinned on INSERT, and the reusable
-- immutability trigger attached from birth. Nothing about the security model is
-- novel; no function is created or altered.
--
-- -----------------------------------------------------------------------------
-- TOOL-LEVEL PERMISSION FROM BIRTH — ONE KEY GATES THE WHOLE TOOL
-- -----------------------------------------------------------------------------
-- Every policy is ANDed with `private.auth_user_has_permission(org_id,
-- 'orders.access')` — the same shape 20260726000001 retrofitted onto candidates,
-- applied here at creation instead of after the fact. The key gates the WHOLE
-- orders tool: later orders tables (products, orders, order lines) reuse it, so
-- access to suppliers and access to prices are ONE decision, never two. There is
-- deliberately no finer split inside the tool.
--
-- The key is bound to NO role here. `auth_user_has_permission` short-circuits on
-- `is_admin`, so today the effect is precisely "org admins only" — the intended
-- interim posture while the tool is verified. Binding `orders.access` to a
-- non-admin role is a separate, reviewed change.
--
-- -----------------------------------------------------------------------------
-- WHY THE IMMUTABILITY TRIGGER IS ATTACHED FROM BIRTH
-- -----------------------------------------------------------------------------
-- 20260716000007's `enforce_tool_row_immutability` freezes visibility / org_id /
-- owner_id after insert. candidates lacks it (a flagged gap); suppliers does not
-- repeat that gap. A supplier belongs to one org (restaurant/branch) for life —
-- moving it would carry its future catalog and order history into another tree.
--
-- Does NOT touch anon or service_role. Touches no other table beyond registering
-- the permission key in public.permissions.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Register the tool permission key. Idempotent: re-applying is a no-op.
-- -----------------------------------------------------------------------------
insert into public.permissions (key, description)
values (
  'orders.access',
  'Access the Orders tool: suppliers, catalogs, prices and orders.'
)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- 2. The table — org-scoped, visibility-bearing, default 'org'.
-- -----------------------------------------------------------------------------
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),

  -- owner_id: NO ACTION (default), matching every tool table. org_id cascades:
  -- removing an org removes its suppliers.
  owner_id uuid not null references public.users (id),
  org_id   uuid not null references public.organizations (id) on delete cascade,

  visibility text not null default 'org'
    check (visibility in ('private', 'org', 'restricted')),

  name         text not null
    check (char_length(name) between 1 and 200),
  phone        text not null default ''
    check (char_length(phone) <= 30),
  contact_name text not null default ''
    check (char_length(contact_name) <= 200),
  email        text not null default ''
    check (char_length(email) <= 320),
  notes        text not null default ''
    check (char_length(notes) <= 2000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table  public.suppliers              is 'Cortex Orders tool — suppliers. Org-scoped: reads key on org_id and inherit DOWN the org tree. Every policy additionally requires the tool-wide orders.access permission.';
comment on column public.suppliers.owner_id     is 'The user who created the supplier. Frozen after insert by the immutability trigger.';
comment on column public.suppliers.org_id       is 'Owning organization (restaurant/branch). NEVER NULL. Frozen after insert.';
comment on column public.suppliers.visibility   is 'Intended audience. Defaults to ''org''. Frozen after insert.';
comment on column public.suppliers.name         is 'Supplier display name. Required (1–200 chars).';
comment on column public.suppliers.phone        is 'Phone as typed ('''' when unset). Normalized to WhatsApp format at send time, not here.';
comment on column public.suppliers.contact_name is 'Contact person at the supplier ('''' when unset).';
comment on column public.suppliers.email        is 'Contact email, free-form ('''' when unset). Not validated at the DB.';
comment on column public.suppliers.notes        is 'Any other contact details — address, delivery days, hours ('''' when unset).';

create index suppliers_org_id_idx   on public.suppliers (org_id);
create index suppliers_owner_id_idx on public.suppliers (owner_id);

-- -----------------------------------------------------------------------------
-- 3. RLS — each policy = the standard row gate AND the tool permission.
-- -----------------------------------------------------------------------------
alter table public.suppliers enable row level security;

grant select, insert, update, delete on public.suppliers to authenticated;

create policy "read suppliers the user is entitled to"
  on public.suppliers for select to authenticated
  using (
    private.auth_user_can_read('suppliers', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'orders.access')
  );

create policy "insert suppliers you may write"
  on public.suppliers for insert to authenticated
  with check (
    private.auth_user_can_write('suppliers', id, org_id, owner_id, visibility)
    and owner_id = (select auth.uid())
    and private.auth_user_has_permission(org_id, 'orders.access')
  );

create policy "update suppliers you may write"
  on public.suppliers for update to authenticated
  using (
    private.auth_user_can_write('suppliers', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'orders.access')
  )
  with check (
    private.auth_user_can_write('suppliers', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'orders.access')
  );

-- DELETE needs USING only — a delete produces no new row to check.
create policy "delete suppliers you may write"
  on public.suppliers for delete to authenticated
  using (
    private.auth_user_can_write('suppliers', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'orders.access')
  );

-- -----------------------------------------------------------------------------
-- 4. Freeze visibility / org_id / owner_id — the EXISTING trigger function from
--    20260716000007, attached as its header instructs (no per-table copy).
-- -----------------------------------------------------------------------------
create trigger suppliers_immutable_fields
  before update on public.suppliers
  for each row
  execute function private.enforce_tool_row_immutability();
