-- =============================================================================
-- Migration: scheduling fields on public.tasks (ADDITIVE)
-- =============================================================================
--
-- Widens the tasks row for the upcoming scheduling UI (the "כללית"/"סוג"
-- placeholder rows already shipped, dormant, in the add-task modal): whether a
-- task carries a real due-date or is just a general to-do, a free-form
-- category, an urgency flag, and where it was postponed from. ADDITIVE ONLY —
-- the table, its RLS policies, grants and indexes (20260717000006) are
-- untouched: policies gate ROWS, not columns, so every existing policy already
-- covers these four new ones without any change.
--
-- Every column is either NOT NULL WITH a default, or nullable — never NOT NULL
-- without one, so every existing row (and every existing insert that doesn't
-- know about these columns) stays valid with no backfill required.
--
-- scheduling     text, NOT NULL DEFAULT 'scheduled', CHECK-constrained to
--                exactly two values ('scheduled' | 'general') — same
--                closed-enum-via-CHECK shape as this table's own `visibility`
--                column. Defaults 'scheduled' so every existing row reads as
--                the more specific of the two states.
-- category       text, NULLABLE, free-form — deliberately NOT a
--                CHECK-constrained enum (unlike `scheduling`/`visibility`):
--                categories are expected to grow, and a closed list would need
--                a migration for every new one.
-- urgent         boolean, NOT NULL DEFAULT false — same shape as candidates'
--                has_certificate/has_car (20260723000002).
-- postponed_from timestamptz, NULLABLE, no default — a task that was never
--                postponed simply has no value here, not a fabricated date.
--                TIMESTAMPTZ (not DATE), matching `due_date` on this same
--                table: a postponement is a real instant, not a
--                calendar-only value.
--
-- Adds NO function, NO trigger, NO index, NO policy. Does NOT touch anon or
-- service_role. Does NOT touch any other table or any existing column.
-- =============================================================================

alter table public.tasks
  add column if not exists scheduling     text not null default 'scheduled'
    check (scheduling in ('scheduled', 'general')),
  add column if not exists category       text,
  add column if not exists urgent         boolean not null default false,
  add column if not exists postponed_from timestamptz;

comment on column public.tasks.scheduling     is 'Whether the task carries a real due-date (''scheduled'') or is a general to-do (''general''). Defaults ''scheduled''.';
comment on column public.tasks.category       is 'Free-form task category/type. Deliberately NOT a closed list (no CHECK) — new categories are expected over time. NULL = uncategorized.';
comment on column public.tasks.urgent         is 'Whether the task is flagged urgent. Plain flag; defaults false.';
comment on column public.tasks.postponed_from is 'The due-date/time the task was postponed FROM, if it was postponed. NULL = never postponed. TIMESTAMPTZ (not DATE), matching due_date on this table.';
