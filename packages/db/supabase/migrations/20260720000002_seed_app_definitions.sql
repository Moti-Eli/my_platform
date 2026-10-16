-- =============================================================================
-- Seed public.app_definitions — the six tool manifests. ADDITIVE, reference data.
-- The table was created empty in 20260714000001; app_instances FK-references it,
-- so instances cannot exist until these rows do. `name` holds the i18n KEY (the
-- client resolves display text from its own registry; this column is reference
-- only). `manifest` is the full AppManifest as JSONB, copied faithfully from the
-- apps/cortex tool manifests. Idempotent via ON CONFLICT (key) DO NOTHING.
-- =============================================================================

insert into public.app_definitions (key, name, category, icon, color, manifest) values
  ('inventory', 'inventory.name', 'business', 'box', 'amber',
   '{"id":"inventory","version":"1.0.0","name":{"key":"inventory.name"},"category":"business","icon":"box","color":"amber","permissions":["org.read","org.write"],"roles":["owner","manager","employee"],"requires":["auth","org-context"],"emits":["inventory.low","inventory.updated"],"listensTo":[],"aiTopics":["inventory","products","quantities","shortages"]}'::jsonb),
  ('tasks', 'tasks.name', 'business', 'check', 'indigo',
   '{"id":"tasks","version":"1.0.0","name":{"key":"tasks.name"},"category":"business","icon":"check","color":"indigo","permissions":[],"roles":["owner","manager","employee"],"requires":["auth","org-context"],"emits":["tasks.created","tasks.completed"],"listensTo":[],"aiTopics":["tasks","todo","reminders","due dates"]}'::jsonb),
  ('staff', 'staff.name', 'business', 'user', 'teal',
   '{"id":"staff","version":"1.0.0","name":{"key":"staff.name"},"category":"business","icon":"user","color":"teal","requiresAdmin":true,"permissions":[],"roles":["owner","manager","employee"],"requires":["auth","org-context"],"emits":[],"listensTo":[],"aiTopics":["staff","employees","team","members"]}'::jsonb),
  ('notes', 'notes.name', 'business', 'document', 'coral',
   '{"id":"notes","version":"1.0.0","name":{"key":"notes.name"},"category":"business","icon":"document","color":"coral","permissions":[],"roles":["owner","manager","employee"],"requires":["auth","org-context"],"emits":[],"listensTo":[],"aiTopics":["notes","memos","documents","jottings"]}'::jsonb),
  ('expenses', 'expenses.name', 'business', 'wallet', 'green',
   '{"id":"expenses","version":"1.0.0","name":{"key":"expenses.name"},"category":"business","icon":"wallet","color":"green","permissions":[],"roles":["owner","manager","employee"],"requires":["auth","org-context"],"emits":[],"listensTo":[],"aiTopics":["expenses","spending","costs","budget"]}'::jsonb),
  ('journal', 'journal.name', 'business', 'book', 'blue',
   '{"id":"journal","version":"1.0.0","name":{"key":"journal.name"},"category":"business","icon":"book","color":"blue","permissions":[],"roles":["owner","manager","employee"],"requires":["auth","org-context"],"emits":[],"listensTo":[],"aiTopics":["journal","diary","entries","log"]}'::jsonb)
on conflict (key) do nothing;
