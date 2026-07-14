-- =============================================================================
-- Migration: Cortex shell tables (super-app core) — ADDITIVE
-- =============================================================================
--
-- Cortex is a super-app platform that HOSTS tools. It reuses the existing
-- Supabase project (auth + the multi-tenant RBAC schema) but lives in its own
-- package (`@platform/cortex-core`) and its own tables. This migration adds ONLY
-- the four "shell" tables the core engine needs. It does NOT touch any existing
-- table (organizations, users, memberships, roles, chat, …).
--
--   * app_definitions — the GLOBAL catalog of available tools (their manifests).
--   * app_instances   — a placed/owned instance of a tool (per user or per org).
--   * events          — the event-bus log (every emit() is persisted here).
--   * ai_log          — the mandatory audit trail written by the data-layer's
--                       one door (runIntent).
--
-- Tool tables (inventory_items, orders, …) and the generative `app_records`
-- table come in LATER prompts; this is the shell layer only.
--
-- -----------------------------------------------------------------------------
-- RLS design (Cortex-SubApp-Standard.md §6, adapted to this repo)
-- -----------------------------------------------------------------------------
-- §6's "three mandatory fields + owner/manager WRITE rule" is explicitly scoped
-- to TOOL tables ("The 3 mandatory fields apply to TOOL tables, not to shell
-- catalog tables"). There are no tool tables yet, so here we:
--
--   * implement §6's SELECT pattern faithfully — a row is readable if
--       owner_id = auth.uid()  OR  the user is a member of org_id —
--     reusing the repo's recursion-safe helper `private.auth_user_is_member_of`
--     for the org check (§6 calls this a "permitted, preferred deviation" over
--     an inline subquery);
--   * write NO client write policies. With RLS enabled, the absence of an
--     INSERT/UPDATE/DELETE policy DENIES those for normal users. All shell
--     writes (registering definitions, creating instances, appending events,
--     writing ai_log) go through the server-side data-layer as `service_role`,
--     which bypasses RLS. This matches the established repo convention (the
--     core RBAC tables and `messages` opened writes one reviewed path at a time;
--     see ARCHITECTURE.md #11). Tool-table write policies (the owner/manager
--     rule) will be added when the first tool table lands.
--
-- app_definitions is the global catalog: it carries NO owner_id/org_id and is
-- readable by any authenticated user (like the `permissions` catalog).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. app_definitions — the GLOBAL tool catalog.
-- -----------------------------------------------------------------------------
-- One row per tool the platform knows about. `manifest` stores the full
-- AppManifest (Standard §1) as JSONB; `key` mirrors manifest.id and is the slug
-- an app_instance's definition resolves to. Not org-scoped and not owned — it is
-- shared reference data seeded/updated by us (server-side).
-- -----------------------------------------------------------------------------
create table public.app_definitions (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,
  name       text not null,
  category   text,
  icon       text,
  color      text,
  manifest   jsonb not null,
  is_core    boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table  public.app_definitions          is 'Global catalog of available Cortex tools (their manifests). Shared reference data; not org-scoped, not owned. Managed server-side.';
comment on column public.app_definitions.key      is 'Stable tool slug; mirrors the manifest id and is what app_instances.definition_id resolves to.';
comment on column public.app_definitions.manifest is 'The full AppManifest (Standard §1) as JSONB.';
comment on column public.app_definitions.is_core  is 'True for built-in tools shipped with the shell (vs. optional/installed ones).';

-- -----------------------------------------------------------------------------
-- 2. app_instances — an owned/placed instance of a tool.
-- -----------------------------------------------------------------------------
-- A tool is instantiated per owner: a PERSONAL instance (owner_type='user',
-- org_id NULL) or an ORG instance (owner_type='org', org_id set). `owner_id` is
-- polymorphic by design (a user id or an org id depending on owner_type), so it
-- is intentionally NOT foreign-keyed to a single table. Membership/permission
-- checks key on org_id (for org instances) or owner_id = auth.uid() (personal).
-- -----------------------------------------------------------------------------
create table public.app_instances (
  id            uuid primary key default gen_random_uuid(),
  definition_id uuid not null references public.app_definitions (id) on delete cascade,
  owner_type    text not null check (owner_type in ('user', 'org')),
  owner_id      uuid not null,
  org_id        uuid references public.organizations (id) on delete cascade,
  config        jsonb not null default '{}'::jsonb,
  is_pinned     boolean not null default false,
  usage_score   numeric not null default 0,
  last_used_at  timestamptz,
  created_at    timestamptz not null default now()
);

comment on table  public.app_instances            is 'An owned instance of a tool (personal or org-scoped). Standard §6 shell table.';
comment on column public.app_instances.owner_type is 'Who owns the instance: ''user'' (personal) or ''org''.';
comment on column public.app_instances.owner_id   is 'Polymorphic owner id (a user id when owner_type=''user'', an org id when ''org''); not FK-constrained for that reason.';
comment on column public.app_instances.org_id     is 'The organization this instance belongs to; NULL for a personal tool (Standard §6).';
comment on column public.app_instances.usage_score is 'Denormalized usage weight used for ranking/surfacing tools.';

-- §6: index on (org_id); plus the definition FK and the personal-owner lookup.
create index app_instances_definition_id_idx on public.app_instances (definition_id);
create index app_instances_org_id_idx        on public.app_instances (org_id);
create index app_instances_owner_id_idx       on public.app_instances (owner_id);

-- -----------------------------------------------------------------------------
-- 3. events — the event-bus log.
-- -----------------------------------------------------------------------------
-- Every emit(type, payload, ctx) persists one row here before dispatching to
-- listeners (Standard §7). The event log is the source of truth, independent of
-- whether any listener is registered. `emitted_by_instance` is nullable + ON
-- DELETE SET NULL so the audit row survives deletion of the emitting instance.
-- -----------------------------------------------------------------------------
create table public.events (
  id                  uuid primary key default gen_random_uuid(),
  type                text not null,
  payload             jsonb not null default '{}'::jsonb,
  emitted_by_instance uuid references public.app_instances (id) on delete set null,
  org_id              uuid references public.organizations (id) on delete cascade,
  user_id             uuid not null references public.users (id) on delete cascade,
  created_at          timestamptz not null default now()
);

comment on table  public.events                     is 'Cortex event-bus log: one row per emitted event, persisted before listener dispatch (Standard §7).';
comment on column public.events.type                is 'Event type, e.g. ''inventory.item_low''.';
comment on column public.events.emitted_by_instance is 'The app_instance that emitted the event (ctx.instanceId); NULLed if that instance is later deleted.';
comment on column public.events.org_id              is 'The active organization (ctx.orgId); NULL for a personal-context event.';
comment on column public.events.user_id             is 'The acting user (ctx.userId).';

create index events_org_id_idx              on public.events (org_id);
create index events_type_idx               on public.events (type);
create index events_emitted_by_instance_idx on public.events (emitted_by_instance);
create index events_user_id_idx            on public.events (user_id);

-- -----------------------------------------------------------------------------
-- 4. ai_log — the mandatory audit trail of the one door.
-- -----------------------------------------------------------------------------
-- The data-layer writes one row here for every runIntent call (Standard §7):
-- which intent, by whom, against which instance, with the validated input (and
-- the handler result). This is the audit surface for all AI (and non-AI) reads
-- and writes that go through the door.
-- -----------------------------------------------------------------------------
create table public.ai_log (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.users (id) on delete cascade,
  intent             text not null,
  target_instance_id uuid references public.app_instances (id) on delete set null,
  input              jsonb,
  result             jsonb,
  created_at         timestamptz not null default now()
);

comment on table  public.ai_log                    is 'Mandatory audit trail written by the data-layer (runIntent) for every call through the one door (Standard §7).';
comment on column public.ai_log.intent             is 'The intent name (<appId>.<action>) that was run.';
comment on column public.ai_log.target_instance_id is 'The app_instance the call was scoped to (ctx.instanceId); NULLed if that instance is later deleted.';
comment on column public.ai_log.input              is 'The zod-validated input passed to the handler.';
comment on column public.ai_log.result             is 'The handler result (logged before output validation returns it to the caller).';

create index ai_log_user_id_idx            on public.ai_log (user_id);
create index ai_log_target_instance_id_idx on public.ai_log (target_instance_id);
create index ai_log_intent_idx            on public.ai_log (intent);

-- =============================================================================
-- Row Level Security
-- =============================================================================
-- RLS filters ROWS but does not grant TABLE privileges, so each table also
-- GRANTs SELECT to `authenticated`; the policies decide which rows apply. No
-- write grant/policy for clients => all writes go through `service_role` (the
-- server-side data-layer), which bypasses RLS. `anon` is granted nothing.
-- `service_role` keeps full DML via the default privileges set in migration
-- 20260608000002 (which also covers future tables).
-- =============================================================================

-- --- app_definitions: global catalog, readable by any authenticated user. ----
alter table public.app_definitions enable row level security;
grant select on public.app_definitions to authenticated;

create policy "authenticated can read the app catalog"
  on public.app_definitions
  for select
  to authenticated
  using ( true );

-- --- app_instances: §6 SELECT — own instance OR a member of its org. ---------
alter table public.app_instances enable row level security;
grant select on public.app_instances to authenticated;

create policy "read own or org app instances"
  on public.app_instances
  for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    or (org_id is not null and private.auth_user_is_member_of(org_id))
  );

-- --- events: §6 SELECT — your own events OR a member of the event's org. -----
alter table public.events enable row level security;
grant select on public.events to authenticated;

create policy "read own or org events"
  on public.events
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (org_id is not null and private.auth_user_is_member_of(org_id))
  );

-- --- ai_log: your own audit rows only (there is no org_id on ai_log). --------
alter table public.ai_log enable row level security;
grant select on public.ai_log to authenticated;

create policy "read own ai log"
  on public.ai_log
  for select
  to authenticated
  using ( user_id = (select auth.uid()) );

-- =============================================================================
-- WRITES are intentionally UNPOLICIED (therefore DENIED) for anon/authenticated
-- on all four tables. Shell writes run server-side as `service_role` through the
-- Cortex data-layer / event-bus. Tool-table write policies (the §6 owner/manager
-- rule) arrive with the first tool table in a later, individually-reviewed
-- migration.
-- =============================================================================
