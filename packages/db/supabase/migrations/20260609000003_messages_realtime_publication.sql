-- =============================================================================
-- Migration: Enable Realtime (Postgres Changes) for `messages` (chat PART 2)
-- =============================================================================
--
-- Realtime "Postgres Changes" streams WAL changes for tables in the
-- `supabase_realtime` publication. We add `public.messages` so clients can
-- subscribe to INSERTs and see new chat messages live.
--
-- SECURITY — tenant isolation over the socket:
--   Postgres Changes ADHERES TO RLS: Realtime only delivers a changed row to a
--   subscriber who is allowed to SELECT it under that table's RLS policies. Our
--   `messages` SELECT policy is `auth_user_is_member_of(organization_id)`, so a
--   subscriber receives a message ONLY if they are a member of its organization
--   — even if a malicious client tampers with the subscription `filter` to point
--   at another org. The client-supplied filter is just a pre-filter; RLS is the
--   real boundary. (Realtime Authorization via `realtime.messages` policies is
--   only for Broadcast/Presence, not Postgres Changes, so nothing extra is
--   needed here.) Verified end-to-end against the live socket.
--
-- Replica identity: default (primary key) is sufficient — we only stream INSERT,
-- whose full new row is always available; we don't need pre-images of
-- UPDATE/DELETE (and those are denied by RLS anyway).
-- =============================================================================

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end
$$;
