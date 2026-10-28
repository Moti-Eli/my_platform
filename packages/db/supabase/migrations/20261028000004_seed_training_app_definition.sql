-- =============================================================================
-- Seed public.app_definitions — the `training` tool manifest. ADDITIVE, reference
-- data, same mechanism as 20261008000006 (shifts): installApp resolves
-- definition_id by key and throws `unknown app "training"` without this row.
-- `name` holds the i18n KEY. `manifest` is a DISPLAY copy for the catalog; the
-- code registry (apps/cortex/src/tools/training/manifest.ts, written with the
-- tool files) stays the source of truth for runtime values.
--
-- A personal tool in the plan's own small org → requiresAdmin false. Category
-- `personal`, icon `spark` and color `amber` carry over from the `fitness`
-- catalog placeholder (stub-apps.ts) this tool replaces.
-- Idempotent via ON CONFLICT (key) DO NOTHING.
-- =============================================================================

insert into public.app_definitions (key, name, category, icon, color, manifest) values
  ('training', 'training.name', 'personal', 'spark', 'amber',
   '{"id":"training","version":"1.0.0","name":{"key":"training.name"},"category":"personal","icon":"spark","color":"amber","requiresAdmin":false,"permissions":[],"roles":["owner","manager","employee"],"defaultVisibility":"org","requires":["auth","org-context"],"emits":[],"listensTo":[],"aiTopics":["training","workout","fitness","exercise","gym"]}'::jsonb)
on conflict (key) do nothing;
