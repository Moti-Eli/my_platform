-- =============================================================================
-- Migration: Shopping lists — PERSONAL list types (stage 2)
--            public.shopping_list_types + public.shopping_list_type_links
-- =============================================================================
--
-- A user sorts their lists by "type" (home, work, business, hobby…). Types are
-- the USER's own — a name and a colour each — and every list the user is in
-- (created or shared) can carry ONE of THEIR types. Two people on the same list
-- each see it in their own type and colour (decision 4A): sharing a list never
-- imposes someone else's categories.
--
-- WHY NO org_id. Every list lives in its own small org (20261028000001), and
-- "My lists" reads across ALL of the user's orgs. A type groups lists from many
-- orgs, so it cannot belong to any one of them; it belongs to the PERSON. Same
-- shape as public.business_cards (20261023000001): owner-only, no org_id, no
-- visibility — NOT a Cortex tool table, and NOT read through the locked
-- auth_user_can_read rule (which is about org rows; nothing here is shared).
--
-- -----------------------------------------------------------------------------
-- 1. shopping_list_types — one row per type, per user
-- -----------------------------------------------------------------------------
--   name     1–40 chars after trimming; unique per user, ignoring case.
--   color    the NAME of a design-system accent token (amber, green, coral…),
--            never a colour value. The DB checks only the token-name shape so a
--            new palette entry needs no migration; the app maps unknown names to
--            a neutral colour.
--   position the user's own order (0 = first).
--   (id, owner_id) is unique — the target of the links' composite FK, which
--   pins every link to a type of the SAME user.
--
-- -----------------------------------------------------------------------------
-- 2. shopping_list_type_links — "my type for this list"
-- -----------------------------------------------------------------------------
--   One row per (user, list): primary key (owner_id, list_id), so a list has at
--   most ONE type per user. type_id → shopping_list_types (id, owner_id): a user
--   can only point at THEIR OWN type. Deleting the type, the list or the user
--   removes the link (cascade).
--   Creating a link requires the list to be READABLE by the user: the INSERT
--   policy's EXISTS runs under shopping_lists' own RLS, so it only sees lists of
--   orgs the user is a member of. A link that outlives the user's access (they
--   left the list's org) stays, visible only to them and pointing at a list they
--   can no longer read — harmless; the app shows only readable lists.
--
-- -----------------------------------------------------------------------------
-- PRIVILEGES
-- -----------------------------------------------------------------------------
-- anon gets nothing (the project's default privileges still hand SELECT to anon
-- on new public tables — revoked explicitly, as business_cards does). A signed-in
-- user reads, creates, edits and deletes THEIR OWN rows only (owner_id =
-- auth.uid() in every policy); column grants keep owner_id / id / list_id out of
-- UPDATE.
--
-- Additive only: alters no existing table, policy or function.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. shopping_list_types
-- -----------------------------------------------------------------------------
create table public.shopping_list_types (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.users (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 40),
  color      text not null check (color ~ '^[a-z]{2,20}$'),
  position   integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shopping_list_types_id_owner_key unique (id, owner_id)
);

comment on table public.shopping_list_types is
  'Shopping lists — a user''s OWN list types (name + colour token). Personal: no org_id; owner-only RLS. Each list the user is in can carry one of them (shopping_list_type_links).';
comment on column public.shopping_list_types.color is
  'The name of a design-system accent token (amber, green, coral…), never a colour value.';

-- One name per user, ignoring case ("Home" and "home" are the same type).
create unique index shopping_list_types_owner_name_key
  on public.shopping_list_types (owner_id, lower(btrim(name)));

revoke all on public.shopping_list_types from anon, authenticated;
grant select, delete on public.shopping_list_types to authenticated;
grant insert (owner_id, name, color, position) on public.shopping_list_types to authenticated;
grant update (name, color, position, updated_at) on public.shopping_list_types to authenticated;

alter table public.shopping_list_types enable row level security;

create policy "shopping list types: read own"
  on public.shopping_list_types for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "shopping list types: create own"
  on public.shopping_list_types for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "shopping list types: edit own"
  on public.shopping_list_types for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "shopping list types: delete own"
  on public.shopping_list_types for delete to authenticated
  using (owner_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- 2. shopping_list_type_links
-- -----------------------------------------------------------------------------
create table public.shopping_list_type_links (
  owner_id   uuid not null references public.users (id) on delete cascade,
  list_id    uuid not null references public.shopping_lists (id) on delete cascade,
  type_id    uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, list_id),
  constraint shopping_list_type_links_type_fk
    foreign key (type_id, owner_id)
    references public.shopping_list_types (id, owner_id) on delete cascade
);

comment on table public.shopping_list_type_links is
  'Shopping lists — which of MY types a list carries (one per user per list). Personal: owner-only RLS; the list must be readable to link it.';

-- The composite FK's referencing columns (deletes of a type cascade through it).
create index shopping_list_type_links_type_idx
  on public.shopping_list_type_links (type_id, owner_id);
-- Deleting a list cascades by list_id.
create index shopping_list_type_links_list_idx
  on public.shopping_list_type_links (list_id);

revoke all on public.shopping_list_type_links from anon, authenticated;
grant select, delete on public.shopping_list_type_links to authenticated;
grant insert (owner_id, list_id, type_id) on public.shopping_list_type_links to authenticated;
grant update (type_id, updated_at) on public.shopping_list_type_links to authenticated;

alter table public.shopping_list_type_links enable row level security;

create policy "shopping list type links: read own"
  on public.shopping_list_type_links for select to authenticated
  using (owner_id = (select auth.uid()));

-- The EXISTS runs under shopping_lists' RLS: only a list the user can read.
create policy "shopping list type links: create own, on a readable list"
  on public.shopping_list_type_links for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.shopping_lists l where l.id = list_id)
  );

create policy "shopping list type links: edit own"
  on public.shopping_list_type_links for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "shopping list type links: delete own"
  on public.shopping_list_type_links for delete to authenticated
  using (owner_id = (select auth.uid()));
