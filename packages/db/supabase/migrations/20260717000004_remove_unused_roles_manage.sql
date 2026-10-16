-- =============================================================================
-- Migration: Remove the unused `roles.manage` permission
-- =============================================================================
--
-- `roles.manage` was seeded in the original catalog (migration 20260605000001)
-- but it is CHECKED NOWHERE. Verified against the live catalog: no `role_permissions`
-- row references it, no function body mentions it (`pg_proc.prosrc`), and no RLS
-- policy mentions it (`pg_policies`). The role-assignment guard that landed in
-- 20260717000003 — `private.auth_user_may_assign_role` — gates assignment on
-- `is_admin` OR holding-the-role-being-conferred, and never reads
-- `role_permissions` at all. So `roles.manage` gates nothing.
--
-- WHY REMOVE RATHER THAN WIRE IT:
--   Unlike `users.view` (which was WRONG — user reads are governed by membership),
--   `roles.manage` is UNBUILT: there is no role-editing UI, so there is no action
--   for it to gate yet. Shipping a granted-but-never-checked key misleadingly
--   implies "this member may edit roles". This is the same dead-permission defect
--   as `users.invite` (deleted in 20260610000003) and `users.view` (deleted in
--   20260717000003). Delete it now and re-add it in the migration that ENFORCES
--   it, so the key and its check land together.
--
-- EFFECT: deleting the permission cascades its `role_permissions` rows away
-- (`role_permissions.permission_id` has ON DELETE CASCADE). The explicit
-- `role_permissions` delete below is a no-op on the live catalog (zero rows
-- reference the key) but keeps this migration correct on any database where the
-- seed granted it — and idempotent. Forward-only: we do NOT edit the historical
-- migration that seeded it (20260605000001); on a fresh replay that migration
-- inserts it and this one removes it (net: absent), the correct forward pattern.
-- =============================================================================

delete from public.role_permissions
where permission_id in (select id from public.permissions where key = 'roles.manage');

delete from public.permissions where key = 'roles.manage';
