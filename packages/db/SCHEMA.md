# Database Schema — Multi-Tenant RBAC

This document explains the core data model in plain English. It is the
companion to the SQL migrations in [`supabase/migrations/`](./supabase/migrations/).

> **Status:** STEP 2 complete. Core tables (Step 1) plus Row Level Security for
> org-membership tenant isolation (Step 2) are applied to the Supabase cloud
> project. See "RLS / Tenant Isolation" below. A **platform-owner (super admin)**
> layer above org admins has also been added (migration `20260609000001`) — see
> "Platform Owner (Super Admin)" below. A `messages` table for **internal org
> chat** (migration `20260609000002`) is also applied — see "Internal Chat
> (messages)" below.

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

## Internal Chat (messages)

The first realtime feature: members of an organization can message each other.
PART 1 (this section) is the **data + RLS** only; realtime delivery and UI come
later. Added in migration `20260609000002`.

### `messages` — org-scoped chat messages

```
messages ( id PK, organization_id → organizations, sender_id → users,
           content text not null, created_at )
```

Org-scoped like everything else (carries `organization_id`). `sender_id`
references `public.users` (whose id mirrors `auth.users.id`, i.e. the value
`auth.uid()` returns). A composite index on `(organization_id, created_at)`
serves the common "load this org's history in order" read. Messages are
**immutable for now** — there are no UPDATE/DELETE policies, so those are denied;
editing/deleting is a deliberate future feature.

### RLS — isolation for reads, anti-forgery for writes

RLS is enabled; `authenticated` is granted `SELECT, INSERT` (the row policies
decide which rows actually apply). `anon` gets nothing.

- **SELECT** — a user may read a message only if they are a member of its
  organization: `private.auth_user_is_member_of(organization_id)` (the same
  recursion-safe SECURITY DEFINER helper used elsewhere). So org A can never read
  org B's chat.
- **INSERT** (`WITH CHECK`) — a user may post a message only if **both**:
  1. they are a member of the target org
     (`private.auth_user_is_member_of(organization_id)`), **and**
  2. `sender_id = auth.uid()` — they are posting **as themselves**.

  Rule (2) is the critical **anti-forgery** guarantee: it is impossible to post a
  message attributed to another user, even inside your own org. Rule (1) blocks
  posting into an org you don't belong to. Both are enforced in the database, not
  app code. Verified end-to-end (6/6): a member posts into their org and reads it
  back; cannot read or insert into another org; and a forged `sender_id` is
  rejected (no forged row lands).

- **UPDATE / DELETE** — no policy, therefore denied (messages are immutable for
  now). Server-side `service_role` bypasses RLS as usual.

---

## Platform Owner (Super Admin)

There is one access level **above** organization admins: the **platform owner**
— the operator of the whole platform, who onboards new client organizations.
This sits *above* tenant isolation, so it is the most security-sensitive
construct in the schema and is built to be explicit, auditable, and impossible
for a normal user to grant themselves. Added in migration `20260609000001`.

### `platform_admins` — the owner allowlist

```
platform_admins ( user_id PK → auth.users(id), created_at, note )
```

One row per platform owner. We use a **dedicated table** rather than a boolean
on `public.users` because it is explicit, auditable (timestamp + note), trivially
revocable (delete the row), and — most importantly — gives the owner flag its own
fully-sealed surface instead of sharing `users`' read surface.

### No-self-assignment guarantee (the critical property)

A regular user has **no API path** to become a platform owner:

- RLS is **enabled** on `platform_admins` with **no policies** for
  `anon`/`authenticated` → every client SELECT/INSERT/UPDATE/DELETE is denied.
- We additionally **`REVOKE ALL`** on the table from `anon` and `authenticated`,
  so even Supabase's default non-DML grants are stripped — the publishable/anon
  key has *zero* privilege on it. (Verified: a client INSERT fails with
  `permission denied for table platform_admins`, and SELECT returns nothing.)
- The **only** way to add a row is server-side as `service_role` (the secret
  key) — i.e. by us, via migration/seed.

There are intentionally **no policies** on this table; do not add client policies
without a separate security review.

### `auth_user_is_platform_owner()` → boolean

A `SECURITY DEFINER` function (STABLE, `search_path = ''`, fully schema-qualified)
that returns whether **the caller** (`auth.uid()`) is in `platform_admins`. It is
placed in the **`public`** schema (unlike the private RLS helpers) on purpose, so
the app layer can call it as a PostgREST RPC to authorize super-admin actions;
`SECURITY DEFINER` is required so it can read the sealed table. It is safe to
expose because it takes **no parameters** and returns **only a boolean about the
caller** — it never reveals the owner list. `EXECUTE` is revoked from `PUBLIC`
and granted only to `authenticated`.

### Cross-org access strategy — server-side only (approach (b))

Platform owners need to read/manage across **all** organizations. We deliberately
do **NOT** widen any existing table's RLS with an `OR auth_user_is_platform_owner()`
branch. Instead, **all** super-admin operations run **server-side** through the
**service-role key** (which already bypasses RLS), gated by an app-level owner
check. Consequences:

- **Tenant isolation is byte-for-byte unchanged.** A platform owner gains **zero**
  extra power through their normal (publishable-key) session; the client-facing
  RLS knows nothing about owners. A stolen owner *session/JWT* therefore cannot
  read cross-org via the public API — you would need the server-only secret key.
- Super-admin features must be built as **server actions / route handlers**
  (e.g. `createOrganizationWithFirstAdmin` in `@platform/auth`, which re-verifies
  ownership server-side before using the service-role client, and rolls back on
  any failure — same pattern as add-member).

### Accepted security-advisor findings (intentional)

Running the Supabase **security advisor** after this migration shows two new,
**expected** findings (no ERROR-level findings; tenant isolation advisories
unchanged):

- **INFO `rls_enabled_no_policy` on `public.platform_admins`** — *intended.* This
  table is meant to be a fully sealed deny-all allowlist; RLS-on-with-no-policy is
  exactly that.
- **WARN `authenticated_security_definer_function_executable` on
  `public.auth_user_is_platform_owner()`** — *intended and reviewed as safe.* The
  function is parameterless and returns only the caller's own boolean (no owner
  enumeration, no other-row access), and `SECURITY DEFINER` is required to read
  the sealed table. Granting `authenticated` execute is deliberate (the app calls
  it via RPC). Accepted, not a defect.

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
- **Covering indexes for `membership_roles` composite FKs — DONE** (migration
  `20260609000006`). The Supabase performance advisor flagged the two composite
  FKs (`membership_roles_membership_fk`, `membership_roles_role_fk`) as lacking a
  covering index (parent deletes would seq-scan `membership_roles`). Added
  `membership_roles_membership_org_idx (membership_id, organization_id)` and
  `membership_roles_role_org_idx (role_id, organization_id)`, and dropped the now
  redundant `membership_roles_role_id_idx (role_id)` (the new role_org index
  leads with `role_id`). Kept `membership_roles_organization_id_idx` (backs the
  org-scoped RLS reads + the last-admin guard). Verified: both
  `unindexed_foreign_keys` findings for `membership_roles` cleared.
  - **Note — separate, newer finding (NOT part of this item):** the performance
    advisor also flags `messages_sender_id_fkey` (from the chat feature) as
    lacking a covering index. A one-line fix (`create index on public.messages
    (sender_id)`) when chat gets a performance pass — tracked here, intentionally
    not bundled with the membership_roles work.
- **Tighten client-role baseline grants — DONE** (migration
  `20260609000004`). `anon`/`authenticated` previously carried Supabase's default
  `TRUNCATE`, `TRIGGER`, `REFERENCES` on every table. These aren't reachable via
  PostgREST, but `TRUNCATE` is destructive and not RLS-gated, so we stripped them
  as defense in depth. The migration does two things:
  1. **Current tables:** `revoke truncate, trigger, references` from
     `anon, authenticated` on all nine public tables.
  2. **Future tables:** `alter default privileges in schema public revoke
     truncate, trigger, references on tables from anon, authenticated`. The
     default-privileges question was **validated** via `pg_default_acl`: these
     grants come from the **`postgres`-owned** default (anon/authenticated =
     `Dxtm`), and our migrations run as `postgres`, so an unqualified
     `alter default privileges` modifies exactly that. The separate
     **`supabase_admin`-owned** default (which grants full privileges) is left
     untouched — it is Supabase-managed and our tables are postgres-owned, so they
     never use it.

  `SELECT`/`INSERT` and every `service_role` grant are deliberately untouched.
  Verified after: anon/authenticated have **no** truncate/trigger/references on
  any table; `authenticated` keeps SELECT (8 tables) + INSERT (membership_roles,
  messages) + UPDATE/DELETE (membership_roles); `service_role` keeps all
  privileges; and a freshly-created probe table grants the client roles none of
  the three.
- **Leaked-password protection + strong passwords (deferred as ONE
  pre-production step).** These two belong together and are intentionally
  deferred while there are **no real users or data**:
  > **Before real users —** upgrade the project to **Pro**, enable Supabase
  > **leaked-password protection (HIBP)**, **AND** switch the seed/all users to a
  > strong, non-breached password. **Intentionally deferred:** the simple `123456`
  > dev password + HIBP off, because there are no real users yet and a strong
  > password is pure friction at this stage.

  Why combined: enabling HIBP rejects breached passwords everywhere a password is
  SET (signup / password update / admin create), so `123456` (seed, the
  add-member action, the platform create-org action) would all break the moment
  HIBP is on — they must flip in the same step. Also note **HIBP requires a Pro
  plan**: the Management API confirms *"Configuring leaked password protection via
  HaveIBeenPwned.org is available on Pro Plans and up,"* so it cannot be toggled
  on the current Free project at all. **To do it later (on Pro):** Dashboard →
  Authentication → password policy → enable *"Leaked password protection"* (or
  `PATCH /v1/projects/{ref}/config/auth { "password_hibp_enabled": true }`), and
  change the dev password constants + re-seed in the same change.

  Until then, the `auth_leaked_password_protection` advisor finding is a **known,
  accepted dev-stage finding**. (The create-user paths also still need a real
  onboarding flow — invite / forced reset — before being user-facing; see
  ARCHITECTURE.md #16/#17.)
- **Harden last-admin protection at DB level — DONE** (migration
  `20260609000005`). The "an organization must never be left with zero admins"
  rule is now enforced in the **database**, not just the app. A **DEFERRABLE
  INITIALLY DEFERRED constraint trigger** (`membership_roles_keep_org_admin`) on
  `membership_roles` runs a SECURITY DEFINER function
  (`private.enforce_org_keeps_admin`, `search_path = ''`) at COMMIT: if the row's
  organization still exists and still has members but no `is_admin` assignment
  remains, it raises and aborts. Deferring to commit is deliberate — it judges the
  *final* state, so it rejects a direct DELETE/UPDATE that strips the last admin
  (verified even via the `service_role` key, 6/6) **without** breaking legitimate
  cascade teardown (deleting the whole org/user, or swapping admins within one
  transaction, is fine because the end state is consistent). This supersedes the
  app-only guard in the member-management server action (which remains as
  fast-feedback UX). See ARCHITECTURE.md #15.
