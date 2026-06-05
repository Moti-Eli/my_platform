# Database Schema — Multi-Tenant RBAC

This document explains the core data model in plain English. It is the
companion to the SQL migrations in [`supabase/migrations/`](./supabase/migrations/).

> **Status:** STEP 1 — core tables only. Row Level Security (RLS) is **not**
> enabled yet and will be added in a separate, individually-reviewed migration.

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

## Notes & deferred work

- **`organization_id` everywhere.** Every org-scoped table carries
  `organization_id`. This is deliberate: it is the column that RLS policies
  will key on to isolate tenants in the next step.
- **Cross-table org consistency — enforced.** A `membership_roles` row links a
  membership and a role that must both belong to the *same* organization. This
  is now guaranteed at the database level via composite foreign keys (see the
  `membership_roles` section above), not left to application code.
- **RLS is not enabled.** No row-level security policies exist yet. Until they
  are added, tenant isolation is **not** enforced at the database level.
- **Soft deletes (planned).** Today every relationship uses physical
  `ON DELETE CASCADE`: deleting an organization (or user) permanently removes
  all dependent rows. Once real data exists we plan to move to **soft deletes**
  — marking rows as deleted (e.g. a `deleted_at` timestamp) instead of
  physically removing them — so that tenant offboarding, audit history, and
  accidental-deletion recovery are possible. The cascades are kept for now
  because the schema is empty and physical deletes keep early development
  simple.
