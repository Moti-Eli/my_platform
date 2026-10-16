-- =============================================================================
-- Load real catalog categories onto the 8 real tool rows in app_definitions.
--
-- Until now every seeded tool carried the placeholder category "business" (both
-- in the `category` column and inside the `manifest` JSONB). This migration
-- replaces that dead value with the real, typed ToolCategory each tool belongs to
-- (mirroring apps/cortex tool manifests + packages/cortex-core's ToolCategory
-- union). It is METADATA ONLY: it touches the `category` column and the manifest's
-- '{category}' key and NOTHING else — no policy, no grant, no other column, no new
-- rows. No UI consumes category yet, so this changes no behavior; it aligns the
-- stored metadata ahead of the roles-management screen.
--
-- Keyed by `key`, driven by a small VALUES map so the column and the JSONB can
-- never drift: both are set from the same source value in one statement.
-- =============================================================================

update public.app_definitions as d
set
  category = v.category,
  manifest = jsonb_set(d.manifest, '{category}', to_jsonb(v.category), true)
from (values
  ('staff',        'people'),
  ('candidates',   'people'),
  ('time_entries', 'people'),
  ('tasks',        'productivity'),
  ('notes',        'productivity'),
  ('expenses',     'finance'),
  ('inventory',    'operations'),
  ('journal',      'personal')
) as v(key, category)
where d.key = v.key;
