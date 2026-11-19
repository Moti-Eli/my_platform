-- =============================================================================
-- Seed public.app_definitions — the `shopping` tool manifest. ADDITIVE, reference
-- data, same mechanism as 20261008000006 (shifts): installApp and
-- shopping.create_list resolve definition_id by key and fail without this row.
-- `name` holds the i18n KEY. `manifest` is a DISPLAY copy for the catalog; the
-- code registry (apps/cortex/src/tools/shopping/manifest.ts) stays the source of
-- truth for runtime values.
--
-- Open to every member (no requiresAdmin): each list lives in its own small org
-- (ARCHITECTURE.md #38) and everyone on a list adds and checks items.
-- Idempotent via ON CONFLICT (key) DO NOTHING.
-- =============================================================================

insert into public.app_definitions (key, name, category, icon, color, manifest) values
  ('shopping', 'shopping.name', 'personal', 'check', 'amber',
   '{"id":"shopping","version":"1.0.0","name":{"key":"shopping.name"},"category":"personal","icon":"check","color":"amber","permissions":[],"roles":["owner","manager","employee"],"defaultVisibility":"org","requires":["auth","org-context"],"emits":[],"listensTo":[],"aiTopics":["shopping","list","groceries","buy","items"]}'::jsonb)
on conflict (key) do nothing;
