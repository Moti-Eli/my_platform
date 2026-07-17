-- =============================================================================
-- Migration: Open the Cortex WRITE PATH for public.inventory_items
-- =============================================================================
--
-- This is the step 20260716000006 was built for. That migration created
-- `private.auth_user_can_write` "unused, on purpose" and said in its own header
-- that it "waits on the Cortex write path (writes are `service_role`-only today,
-- so there is no client write policy for it to gate yet)". This migration IS that
-- write path: it grants INSERT/UPDATE to `authenticated` and adds the two policies
-- that finally call `can_write`. Until now every client write to inventory_items
-- returned 42501 (20260717000001 revoked INSERT/UPDATE from `authenticated`, and
-- no policy admitted the write anyway), which actions.ts maps to "unavailable".
-- This opens exactly that, and nothing wider.
--
-- The adapter routes inventory_items writes to the RLS client, NOT service_role —
-- deliberately, so the access model actually runs (service_role would bypass RLS
-- and every check below). logic.addProduct already writes owner_id = ctx.userId,
-- org_id = ctx.orgId and omits visibility (the column defaults to 'org'). So the
-- rows this path creates are org-visible, owned by their creator, in the caller's
-- org — precisely the shape the policies below admit.
--
-- -----------------------------------------------------------------------------
-- MEMBERSHIP IN THE ORG TREE IS THE GATE. THERE IS NO ACTION-LEVEL PERMISSION.
-- -----------------------------------------------------------------------------
-- `can_write` answers WHICH ROW. The companion question — may this user write
-- this KIND of thing at all (inventory)? — is the action-level permission layer
-- (`private.auth_user_has_permission`), and 20260716000006's header is emphatic
-- that the two are meant to compose with AND at the call site. This migration
-- calls `can_write` and NOT the permission check. That is a decision, not a hole:
--
--   * The Cortex manifest declares "org.read"/"org.write" as its permission keys,
--     but those keys DO NOT EXIST in public.permissions. There is no row to grant,
--     no role_permissions edge to hold, and the real RBAC checker is deliberately
--     left unwired — exactly as server-runtime.ts's own header states.
--
--   * Wiring a permission here would mean inventing a key. A key that no ordinary
--     member could ever hold — there is no role-editing UI to grant one — would
--     lock every ordinary member out of their own tool the instant this shipped.
--     Membership in the org tree would no longer be enough to use inventory; you
--     would also need an admin to hand-grant a permission through a UI that does
--     not exist.
--
--   * And it would be a granted-but-unenforceable key of the exact kind
--     20260717000004 just DELETED roles.manage for: a permission present in the
--     model that nothing can actually confer or check is dead weight an auditor
--     must reason about and that lulls a reader into thinking access is gated when
--     it is not. We do not add another one.
--
-- So the gate is membership: `can_write`'s first, blocking condition is
-- `auth_user_is_member_of_tree(org_id)`. If a later step introduces a real,
-- grantable inventory permission with a UI behind it, it composes on top here —
-- `has_permission(org_id, 'inventory.edit') AND can_write(...)` — without loosening
-- anything below. Nothing about this migration forecloses that.
--
-- -----------------------------------------------------------------------------
-- DELETE STAYS DENIED. NOT AN OMISSION.
-- -----------------------------------------------------------------------------
-- No grant and no policy for DELETE. logic.ts has NO delete path — there is no
-- caller to serve — and this step does not widen scope to invent one. `authenticated`
-- keeps zero DELETE privilege (20260717000001 revoked it), so a delete returns
-- 42501 and reads as "unavailable", the same fail-closed answer as before. When a
-- delete operation genuinely exists in the logic layer, it gets its own policy in
-- its own migration where a reviewer sees it.
--
-- -----------------------------------------------------------------------------
-- WHY owner_id IS PINNED IN THE INSERT CHECK
-- -----------------------------------------------------------------------------
-- The INSERT policy adds `owner_id = (select auth.uid())` ON TOP of `can_write`.
-- can_write alone does NOT pin the inserter as owner: on the 'org' visibility
-- branch it returns true for ANY member of the tree (that branch has no owner
-- condition — org rows are tree-wide by design). Without the extra clause a member
-- could insert a row stamped with someone ELSE's owner_id. And owner_id is
-- IMMUTABLE (20260716000007), so a forged owner would be permanent — unfixable by
-- a later UPDATE, only by delete-and-re-insert. Pinning owner_id to the caller at
-- INSERT time is what makes the immutable column trustworthy from birth.
--
-- The UPDATE policy needs no such clause: owner_id (like org_id and visibility)
-- cannot change at all — the immutability trigger rejects it — so there is nothing
-- to pin. UPDATE gates purely on `can_write` for both the old row (USING) and the
-- new row (WITH CHECK); the two are identical because the immutable columns are the
-- only ones `can_write` reads, and they are guaranteed equal across the update.
-- =============================================================================

grant insert, update on public.inventory_items to authenticated;

create policy "insert inventory rows you may write"
  on public.inventory_items for insert to authenticated
  with check (
    private.auth_user_can_write('inventory_items', id, org_id, owner_id, visibility)
    and owner_id = (select auth.uid())
  );

create policy "update inventory rows you may write"
  on public.inventory_items for update to authenticated
  using      (private.auth_user_can_write('inventory_items', id, org_id, owner_id, visibility))
  with check (private.auth_user_can_write('inventory_items', id, org_id, owner_id, visibility));
