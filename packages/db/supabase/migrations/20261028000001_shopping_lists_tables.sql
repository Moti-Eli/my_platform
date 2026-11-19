-- =============================================================================
-- Migration: The Cortex `shopping` tool — `shopping_lists` + `shopping_list_items` (stage 1)
-- =============================================================================
--
-- First tables of the `shopping` tool: lists for any purpose (home, office,
-- event), each with items that are added, checked off and deleted. Stage 1 is a
-- personal list; stage 2 adds invite-by-link sharing.
--
-- -----------------------------------------------------------------------------
-- ONE LIST = ONE SMALL ROOT ORGANIZATION
-- -----------------------------------------------------------------------------
-- The access model is locked: org-tree membership is a BLOCKING AND on every
-- read and write, and a record grant can only name someone already in the tree
-- (Cortex-Roadmap.md, "The access model"). A list shared with people outside
-- the owner's orgs therefore cannot live in any of those orgs. Instead every
-- list gets its OWN root organization (no parent_id), created by the app with
-- `createOrganizationForCurrentUser` (@platform/auth) — NOT a child org as in
-- the candidates invite flow: a child org is read by its parent's members, so
-- the owner's workplace would see their home list.
--
-- Born in its own org from stage 1, a list never has to move: `org_id` and
-- `visibility` are immutable (20260716000007), so a list born in the active org
-- could never be shared later. Stage 2 "invite" = add a membership to the
-- list's org; no row here changes.
--
-- `shopping_lists_org_id_key` makes it exactly one list per org: the org IS the
-- list's sharing boundary, so a second list in it would silently share the
-- same people.
--
-- -----------------------------------------------------------------------------
-- ACCESS MODEL FOR BOTH TABLES
-- -----------------------------------------------------------------------------
-- * READ: every member of the list's org — `private.auth_user_can_read`, rows
--   are 'org'.
-- * WRITE: every member of the list's org — `private.auth_user_can_write`. No
--   permission key (same posture as `tasks`, 20260717000006): everyone on a
--   list adds and checks items; that is the product.
-- * owner_id pinned on INSERT; immutability trigger (visibility / org_id /
--   owner_id frozen) attached from birth.
--
-- (id, org_id) is unique on the list so items reference it with a COMPOSITE
-- foreign key and the DB refuses an item in a different org than its list (as
-- in orders).
--
-- Does NOT touch anon or service_role. Touches no other table. No function is
-- created or altered.
-- =============================================================================

-- 1. The lists.
create table public.shopping_lists (
  id uuid primary key default gen_random_uuid(),

  owner_id uuid not null references public.users (id),
  org_id   uuid not null references public.organizations (id) on delete cascade,

  visibility text not null default 'org'
    check (visibility in ('private', 'org', 'restricted')),

  name text not null
    check (char_length(name) <= 100 and name ~ '[^[:space:]]'),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint shopping_lists_id_org_id_key unique (id, org_id),
  constraint shopping_lists_org_id_key    unique (org_id)
);

comment on table  public.shopping_lists          is 'Cortex Shopping tool — one list per small root organization (the org is the list''s sharing boundary). Readable and writable by the list org''s members.';
comment on column public.shopping_lists.owner_id is 'The user who created the list. Frozen after insert.';
comment on column public.shopping_lists.org_id   is 'The list''s own root organization (one list per org). Frozen after insert.';
comment on column public.shopping_lists.name     is 'List name shown to the user (1–100 chars). The org''s name is separate and not shown as the list name.';

create index shopping_lists_owner_id_idx on public.shopping_lists (owner_id);
-- (org_id is already indexed by shopping_lists_org_id_key.)

-- 2. The items.
create table public.shopping_list_items (
  id uuid primary key default gen_random_uuid(),

  owner_id uuid not null references public.users (id),
  org_id   uuid not null references public.organizations (id) on delete cascade,

  visibility text not null default 'org'
    check (visibility in ('private', 'org', 'restricted')),

  list_id uuid not null,

  name text not null
    check (char_length(name) <= 200 and name ~ '[^[:space:]]'),
  quantity text not null default ''
    check (char_length(quantity) <= 50),
  checked boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint shopping_list_items_list_fk
    foreign key (list_id, org_id)
    references public.shopping_lists (id, org_id) on delete cascade
);

comment on table  public.shopping_list_items          is 'Cortex Shopping tool — an item on a list. Same-org with its list (composite FK); deleting the list deletes its items.';
comment on column public.shopping_list_items.owner_id is 'The user who added the item. Frozen after insert.';
comment on column public.shopping_list_items.org_id   is 'Must equal the list''s org (composite FK). Frozen after insert.';
comment on column public.shopping_list_items.name     is 'Item name (1–200 chars).';
comment on column public.shopping_list_items.quantity is 'Free-text amount ("2", "1 kg"). '''' = none. Up to 50 chars.';
comment on column public.shopping_list_items.checked  is 'Checked off (bought) on the current list.';

create index shopping_list_items_list_id_idx  on public.shopping_list_items (list_id);
create index shopping_list_items_org_id_idx   on public.shopping_list_items (org_id);
create index shopping_list_items_owner_id_idx on public.shopping_list_items (owner_id);

-- 3. RLS — lists.
alter table public.shopping_lists enable row level security;

grant select, insert, update, delete on public.shopping_lists to authenticated;

create policy "read shopping lists in your org tree"
  on public.shopping_lists for select to authenticated
  using (private.auth_user_can_read('shopping_lists', id, org_id, owner_id, visibility));

create policy "insert shopping lists you may write"
  on public.shopping_lists for insert to authenticated
  with check (
    private.auth_user_can_write('shopping_lists', id, org_id, owner_id, visibility)
    and owner_id = (select auth.uid())
  );

create policy "update shopping lists you may write"
  on public.shopping_lists for update to authenticated
  using      (private.auth_user_can_write('shopping_lists', id, org_id, owner_id, visibility))
  with check (private.auth_user_can_write('shopping_lists', id, org_id, owner_id, visibility));

create policy "delete shopping lists you may write"
  on public.shopping_lists for delete to authenticated
  using (private.auth_user_can_write('shopping_lists', id, org_id, owner_id, visibility));

create trigger shopping_lists_immutable_fields
  before update on public.shopping_lists
  for each row
  execute function private.enforce_tool_row_immutability();

-- 4. RLS — items.
alter table public.shopping_list_items enable row level security;

grant select, insert, update, delete on public.shopping_list_items to authenticated;

create policy "read shopping list items in your org tree"
  on public.shopping_list_items for select to authenticated
  using (private.auth_user_can_read('shopping_list_items', id, org_id, owner_id, visibility));

create policy "insert shopping list items you may write"
  on public.shopping_list_items for insert to authenticated
  with check (
    private.auth_user_can_write('shopping_list_items', id, org_id, owner_id, visibility)
    and owner_id = (select auth.uid())
  );

create policy "update shopping list items you may write"
  on public.shopping_list_items for update to authenticated
  using      (private.auth_user_can_write('shopping_list_items', id, org_id, owner_id, visibility))
  with check (private.auth_user_can_write('shopping_list_items', id, org_id, owner_id, visibility));

create policy "delete shopping list items you may write"
  on public.shopping_list_items for delete to authenticated
  using (private.auth_user_can_write('shopping_list_items', id, org_id, owner_id, visibility));

create trigger shopping_list_items_immutable_fields
  before update on public.shopping_list_items
  for each row
  execute function private.enforce_tool_row_immutability();
