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
- **permissions** — global, code-defined reference data; any authenticated user
  may read the whole catalog.

### Reads only, for now

Only **SELECT** policies exist. There are deliberately **no INSERT / UPDATE /
DELETE policies yet** — and because RLS denies anything without a matching
policy, all writes by normal users are currently **blocked**. Write policies
will arrive with `@platform/auth`, when the action-level permission model is
defined. Server-side code using the Supabase **secret key** runs as
`service_role`, which bypasses RLS, so backend seeding/admin still works.

### How recursion is avoided (the important bit)

A policy on `memberships` that needs to ask "is this user a member of this org?"
would normally re-query `memberships` — and that re-query is itself subject to
the same policy, causing **infinite recursion** (Postgres error `42P17`). We
avoid this by doing every membership lookup inside **`SECURITY DEFINER` helper
functions** in a private (non-API-exposed) schema:

- `private.auth_user_is_member_of(org_id)`
- `private.auth_user_shares_org_with(user_id)`
- `private.auth_user_can_access_role(role_id)`

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
- **RLS is enabled (SELECT only).** Row Level Security is on for all seven
  tables with read policies enforcing org-membership isolation. Write
  (INSERT/UPDATE/DELETE) policies are intentionally deferred until
  `@platform/auth` defines the action-level permission model.
- **Soft deletes (planned).** Today every relationship uses physical
  `ON DELETE CASCADE`: deleting an organization (or user) permanently removes
  all dependent rows. Once real data exists we plan to move to **soft deletes**
  — marking rows as deleted (e.g. a `deleted_at` timestamp) instead of
  physically removing them — so that tenant offboarding, audit history, and
  accidental-deletion recovery are possible. The cascades are kept for now
  because the schema is empty and physical deletes keep early development
  simple.
