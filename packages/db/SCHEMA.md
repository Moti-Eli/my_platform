# Database Schema — Multi-Tenant RBAC

This document explains the core data model in plain English. It is the
companion to the SQL migrations in [`supabase/migrations/`](./supabase/migrations/).

> **Status:** STEP 2 complete. Core tables (Step 1) plus Row Level Security for
> org-membership tenant isolation (Step 2) are applied to the Supabase cloud
> project. See "RLS / Tenant Isolation" below.

---

## The big picture

The platform is **multi-tenant**. The tenant is the **organization**. Almost
everything that exists in the system belongs to exactly one organization, and
the goal of the model is that one organization can never see or touch another
organization's data.

People are modeled as **users**. A user is a global identity (one row per real
person, mirroring their Supabase auth account). Crucially, a user is *not*
owned by an organization — instead, a user **joins** organizations.

The join between a user and an organization is a **membership**. A user can
have many memberships (belong to many organizations), and an organization has
many memberships (many people). The membership is the single most important
table in the model, because **a user's powers are defined on their membership,
never on the user directly**. The same person can be an all-powerful admin in
one organization and a read-only member in another, purely because their two
memberships carry different roles.

Powers come in two layers:

- **Roles** are *data*. Each organization defines its own roles (e.g.
  "Manager", "Volunteer"). Roles are editable by that org's admins through the
  platform. Org A's roles are completely separate from org B's roles.
- **Permissions** are *code*. They are the fixed vocabulary of atomic actions
  the application knows how to check (e.g. `users.invite`, `events.create`).
  They are global, seeded by the engineering team, and never edited by end
  users.

A role is essentially a named bundle of permissions, scoped to one
organization. A membership is given one or more roles. A user's **effective
permissions** in an organization are the union of all permissions across all
roles attached to that membership — plus, if any attached role is the built-in
admin role, *everything*.

---

## The tables

### `organizations` — the tenants
The root of the hierarchy. `id`, `name`, `created_at`. Every org-scoped row
references an organization, and deleting an organization cascades to everything
beneath it.

### `users` — people
One row per real person. The primary key is the **same UUID** as the
corresponding `auth.users` row in Supabase, so this table is the
application-facing profile of an authenticated identity. Holds a denormalized
`email` (unique) and an optional `display_name` so the app can join against it
without reaching into the protected `auth` schema. Users are **global**, not
scoped to any organization.

### `memberships` — user ↔ organization
The link table that puts a user into an organization. Columns: `id`,
`user_id`, `organization_id`, `created_at`. A **unique constraint on
(`user_id`, `organization_id`)** guarantees a person has at most one membership
per organization. This row is the anchor for that user's roles in that org.

### `roles` — per-organization, editable
Tenant-owned roles. Columns: `id`, `organization_id`, `name`, `is_admin`,
`created_at`. Role names are unique **within** an organization (the same name
may exist in other orgs). The `is_admin` flag marks a built-in super-role that
implicitly holds every permission and cannot be stripped of its powers. An
organization may have **multiple** admin roles — the platform does not restrict
the count. The safety rule "an org must never be left with zero admins" is
enforced in application logic, not by the schema.

### `permissions` — global, code-defined
The fixed vocabulary of atomic actions. Columns: `id`, `key` (unique, e.g.
`users.invite`), `description`. Seeded by us via migrations; not user-editable.

### `role_permissions` — role → permissions
Many-to-many join answering "which permissions does this role grant?".
Composite primary key (`role_id`, `permission_id`) prevents duplicates.

### `membership_roles` — membership → roles
Many-to-many join answering "which roles does this membership hold?". A
membership can hold **multiple** roles. Composite primary key
(`membership_id`, `role_id`).

This table carries its own `organization_id` and uses **two composite foreign
keys** — `(membership_id, organization_id)` → `memberships(id, organization_id)`
and `(role_id, organization_id)` → `roles(id, organization_id)`. Because the
same `organization_id` value feeds both foreign keys, the database **guarantees
the membership and the role belong to the same organization**. This makes it
impossible to attach org B's role to an org A membership — a cross-tenant
privilege leak that would otherwise have to be prevented by application code.

---

## Relationship summary

```
organizations 1───* memberships *───1 users
      │                  │
      │ 1                │ 1
      │                  │
      *                  *
    roles ───────* membership_roles
      │ 1
      │
      *
 role_permissions
      │ *
      │
      1
 permissions   (global — not scoped to an organization)
```

In words:

- An **organization** has many **memberships**, many **roles**.
- A **user** has many **memberships** (one per org they belong to).
- A **membership** belongs to exactly one user and one organization, and holds
  many **roles** through `membership_roles`.
- A **role** belongs to exactly one organization and grants many
  **permissions** through `role_permissions`.
- A **permission** is global and may be granted by many roles across many orgs.

---

## How a permission check will work (later)

To decide whether *person P may do action `events.create` in org O*:

1. Find P's **membership** in O (via `user_id` + `organization_id`).
2. Collect every **role** on that membership (via `membership_roles`).
3. If any of those roles `is_admin`, allow.
4. Otherwise, allow iff the `events.create` **permission** is linked to any of
   those roles (via `role_permissions` → `permissions.key`).

This logic will live in `@platform/auth`.

---

## RLS / Tenant Isolation

Row Level Security (RLS) is **enabled on all seven tables**. RLS enforces a
single, narrow job: **tenant isolation** — making sure a user can only see rows
belonging to organizations they are a member of. It is the database-level
guarantee that org A can never read org B's data, even if the application code
has a bug.

### What RLS does *not* do

RLS here is **only about which organization** a row belongs to. It does **not**
decide *who may do what* inside an org (who can invite users, edit roles, delete
records). Those **action-level permission checks belong to `@platform/auth`**,
layered on top later. Keeping the two separate means tenant isolation stays
simple and auditable, and business rules can evolve without touching RLS.

### The rule, table by table

- **organizations** — you can read an org only if you're a member of it.
- **memberships** — you can read memberships of any org you belong to (so you
  can see your co-members), and always your own membership rows.
- **users** — you can read your own profile, plus the profiles of people who
  share at least one organization with you. The global user list is never
  exposed.
- **roles** — readable when the role's organization is one you belong to.
- **role_permissions** — readable when the parent role's organization is one you
  belong to.
- **membership_roles** — readable when the row's organization is one you belong
  to.
- **permissions** — global, code-defined reference data; readable by **anyone**
  (anon and authenticated), since the catalog is non-sensitive and the web
  health check reads it without a session (migration `20260608000001`). Writes
  remain denied.

### Reads only, for now

Most tables are still **read-only** for normal users: only SELECT policies
exist, so RLS denies all their writes. The exception is **`membership_roles`**,
which now has permission-checked write policies (see "Write policies" below).
Server-side code using the Supabase **secret key** runs as `service_role`, which
bypasses RLS, so backend seeding/admin still works.

### Write policies (permission-checked)

Writes are opened up **one path at a time**, each gated by a permission in the
acting user's organization — enforced in the database, not just app code.

So far, only **`membership_roles`** is writable (to support an admin managing a
member's roles). A user may INSERT / UPDATE / DELETE a `membership_roles` row
only if they have the **`members.manage`** permission **in that row's
organization**. The check uses a new helper,
`private.auth_user_has_permission(org_id, permission_key)` — same recursion-safe,
`search_path = ''`, SECURITY DEFINER pattern as the read helpers — which is true
when the user has a membership in the org and one of their roles there is
`is_admin` or is linked to that permission key.

- INSERT uses `WITH CHECK`; DELETE uses `USING`; UPDATE uses both.
- **Org isolation is airtight**: the policy keys on the row's `organization_id`,
  and the composite FKs `(membership_id, organization_id)` / `(role_id,
  organization_id)` mean that id can't be spoofed to another org. So
  `members.manage` in org A cannot write `membership_roles` in org B.
- **Privilege-escalation note (revisit later):** `members.manage` is currently
  granted only to admin roles, so only admins can (re)assign roles. If it is ever
  granted to non-admins, add guardrails (e.g. forbid removing the last admin,
  forbid self-escalation) before doing so.

All other tables (organizations, users, memberships, roles, role_permissions)
remain write-locked pending their own permission-checked policies.

### How recursion is avoided (the important bit)

A policy on `memberships` that needs to ask "is this user a member of this org?"
would normally re-query `memberships` — and that re-query is itself subject to
the same policy, causing **infinite recursion** (Postgres error `42P17`). We
avoid this by doing every membership lookup inside **`SECURITY DEFINER` helper
functions** in a private (non-API-exposed) schema:

- `private.auth_user_is_member_of(org_id)`
- `private.auth_user_shares_org_with(user_id)`
- `private.auth_user_can_access_role(role_id)`
- `private.auth_user_has_permission(org_id, permission_key)` — used by write
  policies to check the acting user's permission in an org

A `SECURITY DEFINER` function runs with its owner's privileges, which **bypass
RLS**, so the lookup does not re-trigger the calling table's policy. Each
function is `STABLE` and pinned with `SET search_path = ''` (with every name
fully schema-qualified) to close the SECURITY DEFINER search-path-hijack hole.

---

## Notes & deferred work

- **`organization_id` everywhere.** Every org-scoped table carries
  `organization_id`. This is deliberate: it is the column the RLS policies key
  on to isolate tenants (see "RLS / Tenant Isolation" above).
- **Cross-table org consistency — enforced.** A `membership_roles` row links a
  membership and a role that must both belong to the *same* organization. This
  is now guaranteed at the database level via composite foreign keys (see the
  `membership_roles` section above), not left to application code.
- **RLS is enabled.** Row Level Security is on for all seven tables with read
  policies enforcing org-membership isolation. Writes are being opened one path
  at a time, each permission-checked: `membership_roles` is writable by users
  with `members.manage` (see "Write policies"); all other tables remain
  write-locked pending their own policies.
- **Soft deletes (planned).** Today every relationship uses physical
  `ON DELETE CASCADE`: deleting an organization (or user) permanently removes
  all dependent rows. Once real data exists we plan to move to **soft deletes**
  — marking rows as deleted (e.g. a `deleted_at` timestamp) instead of
  physically removing them — so that tenant offboarding, audit history, and
  accidental-deletion recovery are possible. The cascades are kept for now
  because the schema is empty and physical deletes keep early development
  simple.
- **Covering indexes for `membership_roles` composite FKs (TODO).** The
  Supabase performance advisor flags the two composite foreign keys
  (`membership_roles_membership_fk`, `membership_roles_role_fk`) as lacking a
  covering index, which makes parent (`memberships`/`roles`) deletes do a
  sequential scan of `membership_roles`. INFO-level only and harmless on an
  empty table, so it is deferred to a later performance pass. The fix:

  ```sql
  create index membership_roles_membership_org_idx
    on public.membership_roles (membership_id, organization_id);
  create index membership_roles_role_org_idx
    on public.membership_roles (role_id, organization_id);
  -- The new role_org index leads with role_id, making the existing
  -- single-column index redundant — drop it in the same migration:
  drop index public.membership_roles_role_id_idx;
  ```
- **Tighten client-role baseline grants (TODO, low-priority).** `anon` and
  `authenticated` carry Supabase's default `TRUNCATE`, `TRIGGER`, `REFERENCES`
  grants on all tables. These are not reachable via the PostgREST API (no
  TRUNCATE endpoint; no schema CREATE rights), so the risk is low — but
  `TRUNCATE` is destructive and not RLS-gated, so stripping it is sensible
  defense-in-depth. Deferred; **needs separate validation against Supabase's
  own default privileges** (future tables may re-acquire these unless the
  `ALTER DEFAULT PRIVILEGES` defaults are also adjusted). Proposed (give it the
  next free timestamp when actually created, e.g.
  `20260608000004_tighten_client_role_grants.sql`):

  ```sql
  revoke truncate, trigger, references on
    public.organizations, public.users, public.memberships, public.roles,
    public.permissions, public.role_permissions, public.membership_roles
  from anon, authenticated;
  ```
- **Leaked-password protection (TODO before production).** Before production —
  enable Supabase leaked-password protection (Auth settings) AND switch the seed
  to a non-breached dev password. Intentionally OFF now so the simple `123456`
  dev password works. (Flagged by the security advisor as
  `auth_leaked_password_protection`; it is an Auth project setting, not a schema
  change.) **The "Add user" admin action**
  (`apps/web/.../dashboard/members/actions.ts → addMemberAction`) uses the same
  known temp password ONLY outside production so new users can log in
  immediately for the demo; in production it falls back to a random,
  never-disclosed password (so the new account can't be a backdoor). Production
  still needs a real onboarding flow — an email invite / magic link or a forced
  password reset on first login — before this is user-facing (see
  ARCHITECTURE.md #16).
- **Harden last-admin protection at DB level (trigger) before production.** The
  "an organization must never be left with zero admins" rule is currently
  enforced only in the app (the member-management server action). A direct API
  caller with `members.manage` could still demote the last admin. Before
  production, enforce it in the database — e.g. a trigger on `membership_roles`
  that rejects removing/over-writing the final `is_admin` role assignment in an
  org. (See ARCHITECTURE.md #15.)
