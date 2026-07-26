-- =============================================================================
-- Seed public.app_definitions — the `time_entries` tool manifest. ADDITIVE,
-- reference data, same mechanism as 20260720000002 (the first six tools) and
-- 20260723000001 (candidates): app_instances FK-references app_definitions, so
-- `time_entries` cannot be installed until this row exists — installApp resolves
-- definition_id by key and throws `unknown app "time_entries"` without it. `name`
-- holds the i18n KEY (the client resolves display text from its own registry;
-- this column is reference only). `manifest` is the full AppManifest as JSONB,
-- copied faithfully from apps/cortex/src/tools/time_entries/manifest.ts (the
-- reference-only manifest column follows the existing seeds and omits the
-- registry-only defaultVisibility field). Idempotent via ON CONFLICT (key) DO NOTHING.
-- =============================================================================

insert into public.app_definitions (key, name, category, icon, color, manifest) values
  ('time_entries', 'time_entries.name', 'business', 'clock', 'teal',
   '{"id":"time_entries","version":"1.0.0","name":{"key":"time_entries.name"},"category":"business","icon":"clock","color":"teal","permissions":[],"roles":["owner","manager","employee"],"requires":["auth","org-context"],"emits":[],"listensTo":[],"aiTopics":["time","hours","timesheet","work log","attendance"]}'::jsonb)
on conflict (key) do nothing;
