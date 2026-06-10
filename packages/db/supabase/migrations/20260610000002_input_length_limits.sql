-- =============================================================================
-- Migration: Bound user-supplied text at the DB layer (CHECK constraints)
-- =============================================================================
--
-- Closes the "unbounded user input" finding (security review M1, and the
-- empty-message finding L2). User-supplied text columns previously had no length
-- bound and no non-empty guarantee — only the UI enforced limits (e.g. the chat
-- composer's maxLength=2000), which a client talking directly to PostgREST with a
-- valid session trivially bypasses. The chat insert in particular has NO server
-- action to validate in (apps/web/.../chat/chat.tsx posts straight to PostgREST),
-- so the DB is the only place this can be enforced.
--
-- We enforce at the DATABASE so the guarantee holds independent of any UI or
-- server action, for every caller including the service-role key:
--
--   * messages.content       — 1..4000 chars, must contain a non-whitespace char.
--   * organizations.name     — 1..200  chars, must contain a non-whitespace char.
--   * roles.name             — 1..200  chars, must contain a non-whitespace char.
--   * users.display_name     — NULL, or 1..200 chars with a non-whitespace char.
--
-- WHY `char_length(X) <= MAX` (raw) **and** `X ~ '[^[:space:]]'`:
--   The raw upper bound is what actually caps storage — it is deliberately
--   STRONGER than bounding only the trimmed length, because a trimmed-only cap
--   would still allow e.g. 1MB of whitespace plus one visible character (trimmed
--   length 1, raw length 1MB) — exactly the storage-abuse vector M1 is about. The
--   `~ '[^[:space:]]'` predicate requires at least one non-whitespace character,
--   so it forbids empty AND whitespace-only values of EVERY kind — spaces, tabs,
--   newlines, etc. (closes L2). We use the regex rather than `btrim(...)` because
--   single-argument `btrim` strips only spaces and would let a tab/newline-only
--   body through. Together: bounded storage + meaningful content.
--
-- Blast radius of an abuse here was always one tenant's own org (tenant isolation
-- is unaffected); these caps remove the abuse vector outright.
--
-- IDEMPOTENT: each constraint is dropped-if-exists then re-added, so this
-- migration is safe to re-run (e.g. after a `migration repair`) and on fresh
-- databases alike. Constraints are added VALIDATED, so the migration fails fast
-- if any existing row violates them (surfaces bad data rather than skipping it).
-- The seed data complies. For a future large table, prefer ADD CONSTRAINT ...
-- NOT VALID + a separate VALIDATE CONSTRAINT to avoid a long lock; these tables
-- are small, so a plain validated add is fine.
-- =============================================================================

alter table public.messages drop constraint if exists messages_content_len_chk;
alter table public.messages
  add constraint messages_content_len_chk
  check (char_length(content) <= 4000 and content ~ '[^[:space:]]');

alter table public.organizations drop constraint if exists organizations_name_len_chk;
alter table public.organizations
  add constraint organizations_name_len_chk
  check (char_length(name) <= 200 and name ~ '[^[:space:]]');

alter table public.roles drop constraint if exists roles_name_len_chk;
alter table public.roles
  add constraint roles_name_len_chk
  check (char_length(name) <= 200 and name ~ '[^[:space:]]');

alter table public.users drop constraint if exists users_display_name_len_chk;
alter table public.users
  add constraint users_display_name_len_chk
  check (display_name is null or (char_length(display_name) <= 200 and display_name ~ '[^[:space:]]'));

comment on constraint messages_content_len_chk on public.messages
  is 'M1: message body bounded to <=4000 chars and must contain a non-whitespace char (DB-enforced; UI maxLength is bypassable).';
comment on constraint organizations_name_len_chk on public.organizations
  is 'M1: org name bounded to <=200 chars and must contain a non-whitespace char.';
comment on constraint roles_name_len_chk on public.roles
  is 'M1: role name bounded to <=200 chars and must contain a non-whitespace char.';
comment on constraint users_display_name_len_chk on public.users
  is 'M1: display_name, when present, bounded to <=200 chars and must contain a non-whitespace char.';
