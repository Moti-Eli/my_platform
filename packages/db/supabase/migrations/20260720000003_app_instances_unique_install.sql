-- =============================================================================
-- app_instances: one install per (owner, org, tool). ADDITIVE.
-- Cortex installs are per-user-per-org: owner_type='user', owner_id=the user,
-- org_id=the org. owner_id is already FK-locked to users(id), so owner_type is
-- always 'user' here and the key needs only (owner_id, org_id, definition_id).
-- This makes installApp idempotent (INSERT ... ON CONFLICT DO NOTHING) and blocks
-- duplicate install rows at the database.
-- =============================================================================

alter table public.app_instances
  add constraint app_instances_owner_org_definition_unique
  unique (owner_id, org_id, definition_id);
