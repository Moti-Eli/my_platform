-- =============================================================================
-- Seed public.app_definitions — the `candidates` tool manifest. ADDITIVE,
-- reference data, same mechanism as 20260720000002 (which seeded the first six
-- tools): app_instances FK-references app_definitions, so `candidates` cannot be
-- installed until this row exists — installApp resolves definition_id by key and
-- throws `unknown app "candidates"` without it. `name` holds the i18n KEY (the
-- client resolves display text from its own registry; this column is reference
-- only). `manifest` is the full AppManifest as JSONB, copied faithfully from
-- apps/cortex/src/tools/candidates/manifest.ts. Idempotent via ON CONFLICT (key)
-- DO NOTHING.
-- =============================================================================

insert into public.app_definitions (key, name, category, icon, color, manifest) values
  ('candidates', 'candidates.name', 'business', 'idcard', 'blue',
   '{"id":"candidates","version":"1.0.0","name":{"key":"candidates.name"},"category":"business","icon":"idcard","color":"blue","permissions":[],"roles":["owner","manager","employee"],"requires":["auth","org-context"],"emits":[],"listensTo":[],"aiTopics":["candidates","recruiting","hiring","onboarding","applicants"]}'::jsonb)
on conflict (key) do nothing;
