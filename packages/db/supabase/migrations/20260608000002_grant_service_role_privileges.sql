-- =============================================================================
-- Migration: Grant service_role full privileges on the public schema
-- =============================================================================
--
-- `service_role` is the trusted, server-side-only role used with the Supabase
-- secret key. It has BYPASSRLS, so it is exempt from Row Level Security — but it
-- still needs table-level privileges (GRANTs) to read/write data.
--
-- On this project, the default privileges did not grant DML to service_role
-- when our migrations created the tables (it ended up with only
-- REFERENCES/TRIGGER/TRUNCATE), so legitimate backend/admin operations — e.g.
-- the local dev seed script — failed with "permission denied for table ...".
--
-- This grants service_role full access to current and future objects in the
-- public schema. anon/authenticated are intentionally NOT broadened here; they
-- remain minimally granted and RLS-gated.
-- =============================================================================

grant usage on schema public to service_role;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

-- Apply to objects created by future migrations too (migrations run as the role
-- executing these defaults).
alter default privileges in schema public grant all privileges on tables to service_role;
alter default privileges in schema public grant all privileges on sequences to service_role;
