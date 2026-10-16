-- =============================================================================
-- Migration: candidate-card fields on public.candidates (ADDITIVE)
-- =============================================================================
--
-- Widens the candidates row for the card UI: contact details (phone / city /
-- email), screening notes (impression / availability / salary_expectation) and
-- two boolean flags (has_certificate / has_car). ADDITIVE ONLY — the table,
-- its RLS policies, grants and indexes (20260722000001) are untouched: policies
-- gate ROWS, not columns, so every existing policy already covers these columns.
--
-- Same column conventions as the rest of the table: text columns are NOT NULL
-- DEFAULT '' (never null — '' is "unset", exactly like role/summary/
-- reject_reason), booleans NOT NULL DEFAULT false. `salary_expectation` is
-- deliberately TEXT, not numeric: it holds free-form ranges ("8-9k", "לפי
-- שעה"), not a number to sum over.
--
-- Adds NO function, NO trigger. Does NOT touch anon or service_role. Does NOT
-- touch any other table.
-- =============================================================================

alter table public.candidates
  add column if not exists has_certificate    boolean not null default false,
  add column if not exists phone              text    not null default '',
  add column if not exists city               text    not null default '',
  add column if not exists email              text    not null default '',
  add column if not exists impression         text    not null default '',
  add column if not exists availability       text    not null default '',
  add column if not exists has_car            boolean not null default false,
  add column if not exists salary_expectation text    not null default '';

comment on column public.candidates.has_certificate    is 'Whether the candidate holds the relevant certificate/license for the role. Plain flag; defaults false.';
comment on column public.candidates.phone              is 'Contact phone, free-form ('''' when unset — never null).';
comment on column public.candidates.city               is 'City / area of residence, free-form ('''' when unset — never null).';
comment on column public.candidates.email              is 'Contact email, free-form ('''' when unset — never null). Not validated at the DB: the card is a notebook, not an identity.';
comment on column public.candidates.impression         is 'Interviewer''s free-form impression notes ('''' when unset — never null).';
comment on column public.candidates.availability       is 'When the candidate can work, free-form ('''' when unset — never null).';
comment on column public.candidates.has_car            is 'Whether the candidate has their own transport. Plain flag; defaults false.';
comment on column public.candidates.salary_expectation is 'Expected salary as free-form TEXT, deliberately not numeric: holds ranges and phrasing ("8-9k", "hourly"), not a number to aggregate.';
