-- =============================================================================
-- Migration: Core Multi-Tenant RBAC Schema (STEP 1 — core tables only)
-- =============================================================================
--
-- This migration establishes the foundational multi-tenant, role-based access
-- control (RBAC) data model for the platform.
--
-- IMPORTANT: This is STEP 1. It defines TABLES, RELATIONSHIPS, INDEXES, and a
-- small set of SEED PERMISSIONS only. Row Level Security (RLS) is intentionally
-- NOT enabled here — it will be added in a separate, individually-reviewed
-- migration so the access-control rules can be reasoned about in isolation.
--
-- Core design principles honored by this schema:
--   * Organizations are the TENANTS. Almost everything is scoped to one org.
--   * A user can belong to MANY organizations (via `memberships`).
--   * A user's roles live on the MEMBERSHIP (user + org pair), never on the
--     user directly. The same person can be an admin in org A and a read-only
--     member in org B.
--   * ROLES are DATA, defined PER ORGANIZATION, and editable by that org's
--     admins later through the platform.
--   * PERMISSIONS are CODE, global, and seeded by us. They are the atomic
--     actions the application checks for; they are not user-editable.
--   * Every org-scoped table carries `organization_id`. This is the column RLS
--     will later key on to isolate tenants.
-- =============================================================================

-- Enable UUID generation (pgcrypto provides gen_random_uuid()).
-- Supabase ships with this available; create-if-missing keeps the migration
-- self-contained and idempotent across fresh databases.
create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. organizations — the TENANTS.
-- -----------------------------------------------------------------------------
-- The top of the multi-tenant hierarchy. Every org-scoped row ultimately
-- belongs to exactly one organization. Deleting an organization cascades to
-- everything scoped to it (memberships, roles, etc.).
-- -----------------------------------------------------------------------------
create table public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

comment on table  public.organizations      is 'Tenants. The root of the multi-tenant hierarchy; org-scoped rows reference this.';
comment on column public.organizations.name is 'Human-readable display name of the organization/tenant.';

-- -----------------------------------------------------------------------------
-- 2. users — people.
-- -----------------------------------------------------------------------------
-- One row per real person. The primary key mirrors Supabase's built-in
-- `auth.users.id`, so this table is the application-facing profile/projection
-- of an authenticated identity. We keep a denormalized copy of email plus a
-- display name here so the app layer can join without reaching into the
-- protected `auth` schema on every query.
--
-- NOTE: users are global identities — they are NOT scoped to an organization.
-- Org membership is expressed separately via `memberships`.
-- -----------------------------------------------------------------------------
create table public.users (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null unique,
  display_name text,
  created_at   timestamptz not null default now()
);

comment on table  public.users              is 'Application-facing person records. id mirrors auth.users.id (one row per real person).';
comment on column public.users.id           is 'Same UUID as the corresponding Supabase auth.users row.';
comment on column public.users.email        is 'Denormalized copy of the auth email for convenient joins; unique.';
comment on column public.users.display_name is 'Optional human-friendly name shown in the UI.';

-- -----------------------------------------------------------------------------
-- 3. memberships — the link between a user and an organization.
-- -----------------------------------------------------------------------------
-- A user can belong to MANY organizations; an organization has MANY users.
-- This table is the join, and it is also the anchor point for a user's roles
-- *within that specific organization* (see `membership_roles`). The unique
-- constraint guarantees one membership row per (user, organization) pair.
-- -----------------------------------------------------------------------------
create table public.memberships (
  id              uuid not null default gen_random_uuid(),
  user_id         uuid not null references public.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (id),
  constraint memberships_user_org_unique unique (user_id, organization_id),
  -- Composite key target so child rows can reference (id, organization_id)
  -- together and thereby pin a membership to its organization (see
  -- membership_roles).
  constraint memberships_id_org_unique unique (id, organization_id)
);

comment on table  public.memberships                 is 'Links a user to an organization. One row per (user, org). Anchor for the user''s roles in that org.';
comment on column public.memberships.user_id         is 'The user who is a member.';
comment on column public.memberships.organization_id is 'The organization the user is a member of.';

-- Indexes on both foreign keys (the unique constraint already covers
-- (user_id, organization_id), so a standalone user_id index is redundant; we
-- add an org_id index for "list all members of an org" queries).
create index memberships_organization_id_idx on public.memberships (organization_id);

-- -----------------------------------------------------------------------------
-- 4. roles — defined PER organization.
-- -----------------------------------------------------------------------------
-- Roles are tenant-owned DATA. Each organization defines its own roles (e.g.
-- "Manager", "Editor"), so org A's roles are completely independent of org B's.
-- This lets each org's admins manage their own roles/permissions later through
-- the platform UI.
--
-- `is_admin` marks a built-in super-role that always has full control and
-- cannot be stripped of its powers. Application/permission logic should treat
-- an admin role as implicitly holding every permission. An organization may
-- have MULTIPLE admin roles — a generic platform should not forbid that. The
-- safety rule "an org must never be left with zero admins" is intentionally
-- enforced in application logic, NOT by restricting how many admin roles exist.
-- -----------------------------------------------------------------------------
create table public.roles (
  id              uuid not null default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null,
  is_admin        boolean not null default false,
  created_at      timestamptz not null default now(),
  primary key (id),
  -- Role names are unique within an organization (but may repeat across orgs).
  constraint roles_org_name_unique unique (organization_id, name),
  -- Composite key target so child rows can reference (id, organization_id)
  -- together and thereby pin a role to its organization (see membership_roles).
  constraint roles_id_org_unique unique (id, organization_id)
);

comment on table  public.roles                 is 'Per-organization roles (data, editable by org admins). Scoped to one org.';
comment on column public.roles.organization_id is 'The organization that owns this role.';
comment on column public.roles.name            is 'Role display name, unique within the organization.';
comment on column public.roles.is_admin        is 'Marks a built-in super-role: implicitly holds all permissions and cannot be stripped. Multiple admin roles per org are allowed; "never zero admins" is enforced in application logic.';

-- FK index for "list all roles in an org" and join performance.
create index roles_organization_id_idx on public.roles (organization_id);

-- -----------------------------------------------------------------------------
-- 5. permissions — atomic actions defined in CODE, global.
-- -----------------------------------------------------------------------------
-- Permissions are the fixed vocabulary of "things the app can check for"
-- (e.g. 'users.invite', 'events.create'). They are GLOBAL (not per-org) and
-- are SEEDED by us in code/migrations — never created or edited by end users.
-- Roles reference permissions via `role_permissions`.
-- -----------------------------------------------------------------------------
create table public.permissions (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  description text
);

comment on table  public.permissions             is 'Global, code-defined atomic actions. Seeded by us; not user-editable.';
comment on column public.permissions.key         is 'Stable machine identifier the app checks, e.g. ''users.invite''. Unique.';
comment on column public.permissions.description is 'Human-readable explanation of what the permission allows.';

-- -----------------------------------------------------------------------------
-- 6. role_permissions — which permissions each role grants.
-- -----------------------------------------------------------------------------
-- Many-to-many between roles (per-org data) and permissions (global code).
-- The composite primary key prevents granting the same permission to a role
-- twice. Deleting either side removes the link.
-- -----------------------------------------------------------------------------
create table public.role_permissions (
  role_id       uuid not null references public.roles (id) on delete cascade,
  permission_id uuid not null references public.permissions (id) on delete cascade,
  primary key (role_id, permission_id)
);

comment on table public.role_permissions is 'Join table: the set of permissions granted by each role.';

-- The PK already indexes (role_id, permission_id) — efficient for "permissions
-- of a role". Add the reverse index for "which roles grant permission X".
create index role_permissions_permission_id_idx on public.role_permissions (permission_id);

-- -----------------------------------------------------------------------------
-- 7. membership_roles — which roles a membership holds.
-- -----------------------------------------------------------------------------
-- A membership (a user-in-an-org) can hold MULTIPLE roles. This is where a
-- user's effective permissions in an organization come from: union of the
-- permissions of all roles attached to their membership (plus everything, if
-- any attached role is is_admin).
--
-- SAME-ORG INTEGRITY (enforced at the DB level — DO NOT weaken):
--   Both the membership and the role are org-scoped. They MUST belong to the
--   SAME organization. If they could differ, a role from org B could be
--   attached to a membership in org A — a cross-tenant privilege leak: a member
--   of org A would silently gain org B's permissions. We refuse to rely on
--   application code for this; tenant isolation is enforced by the schema.
--
--   The mechanism: this table carries a single `organization_id`, and each of
--   the two foreign keys is COMPOSITE — (membership_id, organization_id) must
--   match a real (memberships.id, memberships.organization_id) pair, and
--   (role_id, organization_id) must match a real (roles.id, roles.organization_id)
--   pair. Because the SAME organization_id value feeds both FKs, the membership
--   and the role are forced to share it. A mismatched pair has no valid parent
--   row and the insert fails.
-- -----------------------------------------------------------------------------
create table public.membership_roles (
  membership_id   uuid not null,
  role_id         uuid not null,
  -- The shared organization both parents must agree on. Pinned by the two
  -- composite foreign keys below; it always equals the org of the membership
  -- AND the org of the role.
  organization_id uuid not null,
  primary key (membership_id, role_id),
  -- Composite FK 1: the membership must exist AND belong to organization_id.
  constraint membership_roles_membership_fk
    foreign key (membership_id, organization_id)
    references public.memberships (id, organization_id) on delete cascade,
  -- Composite FK 2: the role must exist AND belong to the SAME organization_id.
  constraint membership_roles_role_fk
    foreign key (role_id, organization_id)
    references public.roles (id, organization_id) on delete cascade
);

comment on table  public.membership_roles                 is 'Join table: the roles assigned to a membership. A membership may have many roles. Composite FKs guarantee the membership and role share one organization (no cross-tenant role leaks).';
comment on column public.membership_roles.organization_id is 'The organization shared by both the membership and the role. Enforced equal to both parents via composite foreign keys.';

-- The PK indexes (membership_id, role_id) — efficient for "roles of a
-- membership". Add the reverse index for "which memberships hold role X"
-- (also supports the role composite FK), plus an org-scoped index.
create index membership_roles_role_id_idx         on public.membership_roles (role_id);
create index membership_roles_organization_id_idx on public.membership_roles (organization_id);

-- =============================================================================
-- Seed data: example global permissions.
-- =============================================================================
-- These illustrate the code-defined permission vocabulary. The real, complete
-- list will be maintained alongside @platform/auth and kept in sync via
-- migrations. `on conflict do nothing` makes re-running safe/idempotent.
-- =============================================================================
insert into public.permissions (key, description) values
  ('users.invite',   'Invite a new user into the organization.'),
  ('users.view',     'View users and their profiles within the organization.'),
  ('roles.manage',   'Create, edit, and delete roles and their permissions.'),
  ('members.manage', 'Add, remove, and change roles of members in the organization.')
on conflict (key) do nothing;
