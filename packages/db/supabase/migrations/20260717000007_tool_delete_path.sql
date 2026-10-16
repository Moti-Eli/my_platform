-- =============================================================================
-- Migration: Open the DELETE path for the Cortex tool tables
-- =============================================================================
--
-- Both tool tables — `inventory_items` (20260717000005) and `tasks`
-- (20260717000006) — granted `authenticated` only INSERT and UPDATE. DELETE was
-- WITHHELD DELIBERATELY: each write-path header said so in as many words ("DELETE
-- STAYS DENIED. NOT AN OMISSION"), because there was no delete caller to serve and
-- opening a verb before anything uses it only widens the surface a reviewer must
-- reason about. That caller is now coming, so this migration opens exactly DELETE,
-- and nothing wider. Until now a client delete returned 42501 (no grant, no policy)
-- and actions.ts mapped it to "unavailable"; this replaces that with a real,
-- row-gated delete.
--
-- -----------------------------------------------------------------------------
-- DELETE REUSES auth_user_can_write — SAME GATE, NO OWNER-ONLY CARVE-OUT
-- -----------------------------------------------------------------------------
-- Decision: anyone who may WRITE a row may DELETE it. Delete is gated by the SAME
-- `private.auth_user_can_write` these tables already use for INSERT/UPDATE — not a
-- narrower owner-only check. Deleting a row is a write in the sense that matters
-- here (it changes the org's data), and the org-tree membership that lets a member
-- edit any 'org'-visible row is the same authority that lets them remove it. An
-- owner-only delete would be a DIFFERENT, stricter rule than write — and inventing
-- that asymmetry (a member may zero a row's contents via UPDATE but not delete it)
-- buys no real protection while surprising every reader. Same power, same gate.
--
-- GENERIC can_write — NO NEW FUNCTION. `private.auth_user_can_write`
-- (20260716000006) takes the table name as its FIRST parameter (p_table_name), so
-- it already serves DELETE for any tool table exactly as it serves INSERT/UPDATE.
-- Each policy passes its own table name and reuses the function as-is; this
-- migration adds no function and touches no existing one.
--
-- MEMBERSHIP IN THE ORG TREE IS THE GATE. can_write's first, blocking condition is
-- `auth_user_is_member_of_tree(org_id)` — lose membership, lose the ability to
-- delete, immediately and by construction. There is no action-level permission
-- composed in, for the same reason it was omitted from the write path: the Cortex
-- manifest's permission keys do not exist in public.permissions. If a real,
-- grantable permission with a UI behind it ever lands, it composes on top
-- (`has_permission(org_id, '<tool>.delete') AND can_write(...)`) without loosening
-- anything here.
--
-- A DELETE policy needs USING only, no WITH CHECK: WITH CHECK validates a NEW row,
-- and a delete produces none. The USING clause decides which existing rows the
-- caller may remove — gated, like the UPDATE policy's USING, purely on can_write.
--
-- Does NOT touch anon or service_role. Adds NO trigger. Touches no other table.
-- =============================================================================

grant delete on public.inventory_items to authenticated;
grant delete on public.tasks to authenticated;

create policy "delete inventory rows you may write"
  on public.inventory_items for delete to authenticated
  using (private.auth_user_can_write('inventory_items', id, org_id, owner_id, visibility));

create policy "delete tasks you may write"
  on public.tasks for delete to authenticated
  using (private.auth_user_can_write('tasks', id, org_id, owner_id, visibility));
