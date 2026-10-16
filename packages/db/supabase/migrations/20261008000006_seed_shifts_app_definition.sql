-- =============================================================================
-- Seed public.app_definitions — the `shifts` tool manifest. ADDITIVE, reference
-- data, same mechanism as 20261005000002 (orders): installApp resolves
-- definition_id by key and throws `unknown app "shifts"` without this row.
-- `name` holds the i18n KEY. `manifest` is a DISPLAY copy for the catalog; the
-- code registry (apps/cortex/src/tools/shifts/manifest.ts, written with the tool
-- files) stays the source of truth for runtime values.
--
-- Stage 1 screens are managers only → requiresAdmin true (the DB itself is
-- readable by every member, for stage 2). Icon `grid` and color `coral` carry
-- over from the catalog placeholder this tool replaces.
-- Idempotent via ON CONFLICT (key) DO NOTHING.
-- =============================================================================

insert into public.app_definitions (key, name, category, icon, color, manifest) values
  ('shifts', 'shifts.name', 'people', 'grid', 'coral',
   '{"id":"shifts","version":"1.0.0","name":{"key":"shifts.name"},"category":"people","icon":"grid","color":"coral","requiresAdmin":true,"permissions":[],"roles":["owner","manager","employee"],"defaultVisibility":"org","requires":["auth","org-context"],"emits":[],"listensTo":[],"aiTopics":["shifts","schedule","rota","staff","availability"]}'::jsonb)
on conflict (key) do nothing;
