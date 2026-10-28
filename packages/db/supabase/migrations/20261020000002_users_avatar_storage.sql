-- =============================================================================
-- Migration: Profile photo — users.avatar_path + private `avatars` bucket
-- =============================================================================
--
-- Cortex profile, stage 1b. A person uploads their own photo; they and the
-- people they share an organization with can see it. Nobody else can.
--
-- DEPENDS ON 20261020000001 (stage 1a), which must be applied first:
--   * it revoked table-level UPDATE on public.users and granted only
--     `display_name` back to `authenticated`;
--   * it added the own-row UPDATE policy (id = auth.uid()).
-- This migration RENAMES that policy (it now covers two columns), so it fails
-- loudly if 1a is missing rather than applying half a model.
--
-- -----------------------------------------------------------------------------
-- 1. THE COLUMN — public.users.avatar_path
-- -----------------------------------------------------------------------------
-- The object's path INSIDE the `avatars` bucket (e.g. "<user id>/avatar"), not a
-- URL: the bucket is private, so the app signs a short-lived URL per view. The
-- CHECK pins the path's first folder to the row's own id, so a user can never
-- point their profile at someone else's file. Nullable = no photo.
-- Writable by the user through the same own-row policy as display_name: one
-- more column grant, no new policy.
--
-- -----------------------------------------------------------------------------
-- 2. THE BUCKET — `avatars`, PRIVATE
-- -----------------------------------------------------------------------------
-- public = false: no permanent public links; every read goes through the
-- storage.objects policy below. 2 MB cap and image types only (the app shrinks
-- photos to ~512px before upload, so real files are far smaller). Upserted so
-- the settings here are the truth even if the bucket was created by hand.
--
-- -----------------------------------------------------------------------------
-- 3. STORAGE POLICIES — storage.objects, bucket `avatars` only
-- -----------------------------------------------------------------------------
-- Every object lives under "<owner user id>/...". The first folder decides:
--   * INSERT / UPDATE / DELETE — only in YOUR folder (folder = auth.uid()).
--   * SELECT — your folder, or the folder of someone you share an active org
--     with (private.auth_user_shares_org_with — the same rule as reading their
--     public.users row; it already ignores soft-deleted memberships and orgs).
-- The SELECT casts the folder to uuid only after a CASE has checked its shape,
-- so a stray non-uuid folder can never make the policy raise. All policies are
-- `to authenticated`; anon gets nothing.
--
-- Does NOT touch service_role. Alters no other table. No function is created.
-- =============================================================================

-- 1. Column + privilege.
alter table public.users
  add column avatar_path text,
  add constraint users_avatar_path_own_folder_chk
    check (
      avatar_path is null
      or (char_length(avatar_path) <= 200 and split_part(avatar_path, '/', 1) = id::text)
    );

comment on column public.users.avatar_path is
  'Profile photo: object path inside the private `avatars` bucket ("<id>/..."), not a URL. Null = no photo. Writable by the user on their own row only.';

grant update (avatar_path) on public.users to authenticated;

-- The 1a policy now covers display_name AND avatar_path (the column grants
-- decide which columns; the policy decides which row).
alter policy "users can update their own display name"
  on public.users
  rename to "users can update their own profile fields";

-- 2. The bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 3. Storage policies.
create policy "avatars: read own and co-members"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'avatars'
    and case
      when (storage.foldername(name))[1] = (select auth.uid())::text then true
      when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then private.auth_user_shares_org_with(((storage.foldername(name))[1])::uuid)
      else false
    end
  );

create policy "avatars: upload to own folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "avatars: replace in own folder"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "avatars: delete from own folder"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
