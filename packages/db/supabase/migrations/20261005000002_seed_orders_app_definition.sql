-- =============================================================================
-- Seed public.app_definitions — the `orders` tool manifest. ADDITIVE,
-- reference data, same mechanism as 20260723000001 (candidates): app_instances
-- FK-references app_definitions, so `orders` cannot be installed until this row
-- exists — installApp resolves definition_id by key and throws
-- `unknown app "orders"` without it. `name` holds the i18n KEY (the client
-- resolves display text from its own registry; this column is reference only).
-- `manifest` is the full AppManifest as JSONB, copied faithfully from
-- apps/cortex/src/tools/orders/manifest.ts — a DISPLAY copy for the catalog; the
-- code registry stays the source of truth for runtime values.
-- Idempotent via ON CONFLICT (key) DO NOTHING.
-- =============================================================================

insert into public.app_definitions (key, name, category, icon, color, manifest) values
  ('orders', 'orders.name', 'operations', 'send', 'green',
   '{"id":"orders","version":"1.0.0","name":{"key":"orders.name"},"category":"operations","icon":"send","color":"green","requiresAdmin":true,"permissions":[],"roles":["owner","manager","employee"],"defaultVisibility":"org","requires":["auth","org-context"],"emits":[],"listensTo":[],"aiTopics":["orders","suppliers","purchasing","vendors"]}'::jsonb)
on conflict (key) do nothing;
