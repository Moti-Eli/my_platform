-- =============================================================================
-- Seed public.app_definitions — the `questionnaire` tool manifest. ADDITIVE,
-- reference data, same mechanism as 20260720000002 (the first six tools),
-- 20260723000001 (candidates) and 20260723000005 (time_entries): app_instances
-- FK-references app_definitions, so `questionnaire` cannot be installed until this
-- row exists — installApp resolves definition_id by key and throws
-- `unknown app "questionnaire"` without it.
--
-- WHAT THIS TOOL IS. The candidate-facing questionnaire. It renders the CALLER'S
-- OWN `candidate_answers` rows — the ones created by the invite sequence
-- (inviteCandidateCore) inside the candidate's CHILD ORG, owned by the candidate
-- user. It is installed AUTOMATICALLY at invite time (not from the catalog), and it
-- holds NO TABLE OF ITS OWN: `candidate_answers` (20260727000001) is its storage,
-- and the ordinary org-tree RLS on that table is its whole access model — a
-- candidate reads/writes their own answers as a member of their own child org.
--
-- COLUMN NOTES (where this row deliberately differs from the template):
--   * `name` holds the LITERAL Hebrew display text "שאלון", NOT an i18n key like the
--     other rows ("time_entries.name" etc.). Those tools resolve their display name
--     from the client's own i18n registry; this auto-installed, candidate-facing
--     tool has no such registry entry, so the display text is carried here.
--   * `category` is 'people' (the recruiting family — candidates is 'people'), NOT
--     the template's legacy 'business': that value was retired from the ToolCategory
--     set by 20260728000001, so a new row must name a live category.
-- `manifest` is the AppManifest as JSONB, shaped like the existing seeds.
-- Idempotent via ON CONFLICT (key) DO NOTHING.
-- =============================================================================

insert into public.app_definitions (key, name, category, icon, color, manifest) values
  ('questionnaire', 'שאלון', 'people', 'document', 'blue',
   '{"id":"questionnaire","version":"1.0.0","name":{"key":"questionnaire.name"},"category":"people","icon":"document","color":"blue","permissions":[],"roles":["owner","manager","employee"],"requires":["auth","org-context"],"emits":[],"listensTo":[],"aiTopics":["questionnaire","answers","candidate","intake"]}'::jsonb)
on conflict (key) do nothing;
