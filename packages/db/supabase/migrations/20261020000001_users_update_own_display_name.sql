-- =============================================================================
-- Migration: Let a signed-in user rename THEMSELVES (public.users.display_name)
-- =============================================================================
--
-- The profile screen (Cortex, stage 1a) lets a person edit their own name. Until
-- now public.users had a SELECT policy only (20260605000002), so every client
-- UPDATE was denied by RLS. This opens exactly ONE write path:
--
--     a signed-in user may UPDATE the `display_name` of THEIR OWN row.
--
-- Nothing else: not `email`, not `id`, not `created_at`, not anyone else's row,
-- and no INSERT or DELETE.
--
-- TWO LAYERS, both needed:
--
-- 1. PRIVILEGE (which columns). 20260717000001 records that `authenticated`
--    (and `anon`) still hold table-level UPDATE on public.users, inherited from
--    Supabase's default privileges — a known, deferred debt. A table-level UPDATE
--    covers EVERY column, so a column grant on its own would narrow nothing. We
--    therefore revoke table-level UPDATE from both client roles (a no-op where it
--    is already absent — this does not depend on the current catalog state) and
--    grant UPDATE on the single `display_name` column back to `authenticated`.
--    Per the PostgreSQL docs, revoking a table-level privilege also revokes the
--    matching column-level privileges, so the order (revoke, then grant) leaves
--    exactly one column writable. An UPDATE that names any other column fails
--    with 42501 "permission denied for table users".
--
--    Safe to revoke: no client code updates public.users. Every existing write
--    (signup, add-member, create-org provisioning in @platform/auth) runs on the
--    service client, which this migration does not touch.
--
-- 2. ROW (whose row). An UPDATE policy pinned to `id = auth.uid()` in both USING
--    (which rows can be targeted) and WITH CHECK (what the row may become). `id`
--    is not writable anyway (layer 1), so the CHECK is belt-and-braces. A user
--    targeting a co-member's row matches 0 rows — RLS filters it, no error.
--
-- The existing CHECK constraint users_display_name_len_chk (20260610000002:
-- null, or <=200 chars with a non-whitespace char) still applies to these writes.
--
-- Does NOT touch service_role. Does NOT change INSERT/DELETE grants (still the
-- deferred debt above, still denied by RLS). Alters no other table.
-- =============================================================================

-- 1. Privilege: only the display_name column is writable by a signed-in user.
revoke update on public.users from anon, authenticated;
grant update (display_name) on public.users to authenticated;

-- 2. Row: only your own row.
create policy "users can update their own display name"
  on public.users
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
