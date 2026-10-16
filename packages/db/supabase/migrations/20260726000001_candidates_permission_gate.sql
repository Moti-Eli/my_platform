-- =============================================================================
-- Migration: Gate the Candidates tool behind the `candidates.access` permission
-- =============================================================================
--
-- WHAT THIS DOES. It composes an ACTION-LEVEL permission check onto all four
-- candidates policies. Until now the row-level gate was membership in the org
-- tree alone (`auth_user_can_write` / `is_member_of_tree`), exactly as the
-- table's own header (20260722000001) described — and that header anticipated
-- this change almost to the letter: "If a real, grantable candidate permission
-- with a UI behind it ever lands, it composes on top
-- (`has_permission(org_id, 'candidates.edit') AND can_write(...)`) without
-- loosening anything here." This is that migration; the key is `candidates.access`.
--
-- Each of the four policies is DROPPED and RECREATED identical to its current
-- form PLUS `and private.auth_user_has_permission(org_id, 'candidates.access')`.
-- The expressions are copied verbatim from the live catalog / the table's
-- creating migration — nothing about the existing gates is rewritten, only
-- conjoined with the new permission check, so a caller must satisfy BOTH the old
-- row-level rule AND now hold the permission.
--
-- WHY ADMINS STILL PASS, WITH NO ROLE BINDING. `private.auth_user_has_permission`
-- short-circuits on `r.is_admin` before it ever consults role_permissions, so
-- every org admin passes the new check for free. We therefore DELIBERATELY seed
-- NO row into role_permissions here: binding `candidates.access` to a role is
-- reserved for the day a real, non-admin recruiter exists and needs a dedicated
-- role. Until then the gate's effect is precisely "admins only", which is the
-- intended interim posture — a plain member (e.g. a teacher) can no longer read
-- or write candidate records.
--
-- FIRST POLICY CHANGE ON A TABLE WITH LIVE DATA. Every prior candidates policy
-- migration created the table or added columns; this is the first to alter the
-- ACCESS rules on candidates rows that already exist in the wild. There is no
-- data migration — rows are untouched — but the blast radius is real: anyone
-- who is not an admin (and holds no role bound to `candidates.access`) loses
-- access to candidate rows the instant this applies. That is the point of the
-- gate, and it is why the change is isolated to policies here and verified by
-- scripts/verify-candidates-gate.ts (assertions A–D) before and after.
--
-- SCOPE. Touches ONLY: one insert into public.permissions, and the four
-- candidates policies. No function is created or altered, no grants change, no
-- other table is touched.
-- =============================================================================

-- 1. Register the permission key. Description states the tool and that the key
--    covers both reading and writing candidate records. Idempotent: re-applying
--    (or a later migration that also references it) is a no-op.
insert into public.permissions (key, description)
values (
  'candidates.access',
  'Access the Candidates (recruiting) tool: read and write candidate records.'
)
on conflict (key) do nothing;

-- 2. Recreate the four policies with the permission check conjoined onto each.
--    Drop-then-create (not alter) so the full expression is stated in one place,
--    exactly as the creating migration did.

-- SELECT — org-visible rows in the caller's org tree, now also permission-gated.
drop policy if exists "read org-visible candidates in your org tree" on public.candidates;
create policy "read org-visible candidates in your org tree"
  on public.candidates
  for select
  to authenticated
  using (
    private.auth_user_is_member_of_tree(org_id)
    and visibility = 'org'
    and private.auth_user_has_permission(org_id, 'candidates.access')
  );

-- INSERT — can_write + the owner pin, now also permission-gated.
drop policy if exists "insert candidates you may write" on public.candidates;
create policy "insert candidates you may write"
  on public.candidates for insert to authenticated
  with check (
    private.auth_user_can_write('candidates', id, org_id, owner_id, visibility)
    and owner_id = (select auth.uid())
    and private.auth_user_has_permission(org_id, 'candidates.access')
  );

-- UPDATE — can_write on both the old row (USING) and the new row (WITH CHECK),
-- each now also permission-gated.
drop policy if exists "update candidates you may write" on public.candidates;
create policy "update candidates you may write"
  on public.candidates for update to authenticated
  using (
    private.auth_user_can_write('candidates', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'candidates.access')
  )
  with check (
    private.auth_user_can_write('candidates', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'candidates.access')
  );

-- DELETE — same gate as write (no owner-only carve-out), now also permission-gated.
drop policy if exists "delete candidates you may write" on public.candidates;
create policy "delete candidates you may write"
  on public.candidates for delete to authenticated
  using (
    private.auth_user_can_write('candidates', id, org_id, owner_id, visibility)
    and private.auth_user_has_permission(org_id, 'candidates.access')
  );
