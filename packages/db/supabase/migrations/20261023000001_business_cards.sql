-- =============================================================================
-- Migration: Business cards — public.business_cards + public card lookup +
--            `card-images` bucket
-- =============================================================================
--
-- Cortex profile, stage 2. A person creates their OWN business card(s): a name
-- (required), plus optionally a title/field, phone, short description and an
-- image. Every card has a public page (/c/<slug>) that anyone can open without
-- signing in. The schema allows many cards per person; the app offers one for now.
--
-- A card belongs to a PERSON, not an organization: no org_id, no visibility.
-- It is not a Cortex tool table (see ARCHITECTURE.md) — one person can be a
-- waiter in one org and an artist on their own, and the card goes with them.
--
-- -----------------------------------------------------------------------------
-- WHAT `anon` (NOT SIGNED IN) CAN DO — AND CANNOT
-- -----------------------------------------------------------------------------
-- anon gets NO privilege on the table at all. The project's default privileges
-- still hand SELECT to anon on every new public table (20260717000001 kept it on
-- purpose), so it is revoked explicitly below. A direct
-- `select * from business_cards` as anon fails with "permission denied" — there
-- is no way to list, search or count cards.
--
-- The public page instead calls ONE function, get_public_business_card(slug). It
-- returns exactly one card, and only if the caller already holds its slug — a
-- random 16-hex-character code (64 bits) from the card's link. It returns only
-- the fields shown on the page: name, title, phone, description, image_path.
-- Never the card id, the owner's user id, their email, or any organization.
--
-- -----------------------------------------------------------------------------
-- WHAT A SIGNED-IN USER CAN DO
-- -----------------------------------------------------------------------------
-- Read, create, edit and delete THEIR OWN cards only (owner_id = auth.uid() in
-- every policy). Column grants narrow it further:
--   * INSERT: owner_id, name, title, phone, description — `id` and `slug` always
--     come from the defaults, so nobody picks a vanity or guessable slug.
--   * UPDATE: name, title, phone, description, image_path, updated_at — never
--     owner_id, slug or id.
-- Other people's cards are reachable only through the public function, like
-- anyone else.
--
-- -----------------------------------------------------------------------------
-- THE IMAGE BUCKET — `card-images`, PUBLIC READ
-- -----------------------------------------------------------------------------
-- A card is public by design, so its image is too: public = true means a file is
-- downloadable by its exact URL. Objects live under "<card id>/..." — the CARD id,
-- not the user id, so a public image URL never reveals who owns it. Writing
-- (insert / update / delete) is allowed only into the folder of a card you own.
-- A SELECT policy exists for owners only (the storage API needs it to replace a
-- file); there is none for anon, so nobody can LIST the bucket. 2 MB, images only.
-- The folder is cast to uuid only after a CASE has checked its shape, so a stray
-- folder name can never make a policy raise.
--
-- Deleting a card does not delete its file by itself: the app removes the image
-- when it deletes the card.
--
-- Does NOT touch service_role. Alters no existing table.
-- =============================================================================

-- 1. The table.
create table public.business_cards (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.users (id) on delete cascade,
  slug        text not null unique
                default substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)
                check (slug ~ '^[0-9a-f]{16}$'),
  name        text not null
                check (char_length(name) between 1 and 100 and name ~ '[^[:space:]]'),
  title       text check (title is null or char_length(title) <= 100),
  phone       text check (phone is null or char_length(phone) <= 30),
  description text check (description is null or char_length(description) <= 300),
  image_path  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint business_cards_image_path_own_folder_chk
    check (
      image_path is null
      or (char_length(image_path) <= 200 and split_part(image_path, '/', 1) = id::text)
    )
);

comment on table public.business_cards is
  'Cortex profile — a person''s own business cards (many per person; the app offers one). Personal, not org-scoped. Owner-only through RLS; the public page reads one card by slug via get_public_business_card().';
comment on column public.business_cards.slug is
  'Random 16-hex code in the public link (/c/<slug>). Set by the default only; not client-writable.';
comment on column public.business_cards.image_path is
  'Object path inside the public `card-images` bucket ("<card id>/..."), not a URL. Null = no image.';

create index business_cards_owner_id_idx on public.business_cards (owner_id);

-- 2. Privileges. Start from nothing for both client roles, then grant back
--    exactly what the owner needs.
revoke all on public.business_cards from anon, authenticated;
grant select, delete on public.business_cards to authenticated;
grant insert (owner_id, name, title, phone, description) on public.business_cards to authenticated;
grant update (name, title, phone, description, image_path, updated_at) on public.business_cards to authenticated;

-- 3. Row access: your own cards only.
alter table public.business_cards enable row level security;

create policy "business cards: read own"
  on public.business_cards for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "business cards: create own"
  on public.business_cards for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "business cards: edit own"
  on public.business_cards for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "business cards: delete own"
  on public.business_cards for delete to authenticated
  using (owner_id = (select auth.uid()));

-- 4. The public lookup: one card by slug, display fields only.
create function public.get_public_business_card(p_slug text)
returns table (name text, title text, phone text, description text, image_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.name, c.title, c.phone, c.description, c.image_path
  from public.business_cards c
  where c.slug = p_slug
  limit 1;
$$;

comment on function public.get_public_business_card(text) is
  'Public business-card page: returns ONE card''s display fields by its slug. Never the id or owner. The only anon path to business_cards.';

revoke all on function public.get_public_business_card(text) from public;
grant execute on function public.get_public_business_card(text) to anon, authenticated;

-- 5. The image bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('card-images', 'card-images', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 6. Storage policies — writes only into a folder named after a card you own.
create policy "card images: owners read own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'card-images'
    and case
      when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then exists (
          select 1 from public.business_cards c
          where c.id = ((storage.foldername(name))[1])::uuid
            and c.owner_id = (select auth.uid())
        )
      else false
    end
  );

create policy "card images: upload to own card"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'card-images'
    and case
      when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then exists (
          select 1 from public.business_cards c
          where c.id = ((storage.foldername(name))[1])::uuid
            and c.owner_id = (select auth.uid())
        )
      else false
    end
  );

create policy "card images: replace in own card"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'card-images'
    and case
      when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then exists (
          select 1 from public.business_cards c
          where c.id = ((storage.foldername(name))[1])::uuid
            and c.owner_id = (select auth.uid())
        )
      else false
    end
  )
  with check (
    bucket_id = 'card-images'
    and case
      when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then exists (
          select 1 from public.business_cards c
          where c.id = ((storage.foldername(name))[1])::uuid
            and c.owner_id = (select auth.uid())
        )
      else false
    end
  );

create policy "card images: delete from own card"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'card-images'
    and case
      when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then exists (
          select 1 from public.business_cards c
          where c.id = ((storage.foldername(name))[1])::uuid
            and c.owner_id = (select auth.uid())
        )
      else false
    end
  );
