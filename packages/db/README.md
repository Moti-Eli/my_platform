# @platform/db

Database client, schema, and migrations.

## Structure

- `src/` - Supabase client factories (browser + server)
- `supabase/migrations/` - Database migrations
- `scripts/seed.ts` - Local dev seed script (test orgs + users)
- [`SCHEMA.md`](./SCHEMA.md) - Plain-English entity-relationship explanation

## Schema

The core data model is a **multi-tenant RBAC** design (organizations as
tenants; users link to orgs via memberships; roles live on the membership;
permissions are global and code-defined). See [`SCHEMA.md`](./SCHEMA.md) for the
full explanation.

**Migrations:**

- `20260605000001_core_rbac_schema.sql` — core tables, indexes, seed permissions.
- `20260605000002_enable_rls_tenant_isolation.sql` — RLS + org-membership
  tenant-isolation policies (SELECT only).
- `20260608000001_allow_public_read_permissions.sql` — makes the global
  permission catalog anon-readable.
- `20260608000002_grant_service_role_privileges.sql` — grants `service_role`
  full DML on the public schema (used by trusted server-side code / the seed).
- `20260608000003_membership_roles_write_policy.sql` — first permission-checked
  write path: users with `members.manage` may assign/unassign roles on a
  membership in their own org (`auth_user_has_permission` helper).
- `20260609000001_platform_admins_super_admin.sql` — **platform-owner (super
  admin)** layer above org admins: a sealed `platform_admins` allowlist (RLS
  deny-all + `REVOKE ALL`, writable only server-side via `service_role`) and the
  `auth_user_is_platform_owner()` RPC. No cross-org RLS is added — super-admin
  power is server-side only. See [`SCHEMA.md`](./SCHEMA.md).
- `20260609000002_messages_org_chat.sql` — **internal org chat** `messages`
  table (org-scoped) with RLS: members-only SELECT, and INSERT requiring org
  membership **and** `sender_id = auth.uid()` (anti-forgery). Immutable for now
  (no update/delete). PART 1 of the chat feature (data + RLS only).
- `20260609000003_messages_realtime_publication.sql` — adds `messages` to the
  `supabase_realtime` publication so clients can subscribe to live INSERTs
  (Postgres Changes). RLS still gates delivery, so the socket respects org
  isolation. PART 2 of the chat feature.
- `20260609000004_tighten_client_role_grants.sql` — defense in depth: revokes
  `TRUNCATE`/`TRIGGER`/`REFERENCES` from `anon`/`authenticated` on every current
  public table, and adjusts the `postgres`-owned default privileges so future
  tables don't re-grant them. `TRUNCATE` is destructive and **not** gated by RLS,
  hence the strip. SELECT/INSERT and every `service_role` grant are untouched.
- `20260609000005_last_admin_db_guard.sql` — **DB-level last-admin guard**: a
  DEFERRABLE INITIALLY DEFERRED constraint trigger on `membership_roles`
  (`private.enforce_org_keeps_admin`, SECURITY DEFINER) rejecting any operation
  that would leave an existing org (that still has members) with zero `is_admin`
  assignments. Judged at COMMIT on the transaction's FINAL state, so cascade
  deletes and add-then-drop admin swaps still pass. Holds even against
  `service_role`, so it can't be bypassed by a direct privileged call.
- `20260609000006_membership_roles_covering_indexes.sql` — covering indexes for
  the two composite FKs on `membership_roles` — `(membership_id,
  organization_id)` and `(role_id, organization_id)` — so deleting a membership
  or role no longer seq-scans the table. Drops the now-redundant `role_id`-only
  index (the new composite leads with it); keeps `organization_id` (it backs the
  org-scoped RLS reads and the last-admin guard's count).
- `20260609000007_messages_sender_id_index.sql` — covering index on
  `messages.sender_id` for its FK to `users.id`, so deleting a user no longer
  seq-scans `messages`.
- `20260610000001_soft_deletes.sql` — **soft deletes** for `organizations`,
  `memberships`, `messages`: a nullable `deleted_at` (NULL = active), a new
  `private.org_is_active` helper, and the membership helpers
  (`auth_user_is_member_of`, `auth_user_shares_org_with`,
  `auth_user_can_access_role`, `auth_user_has_permission`) become
  `deleted_at`-aware — a membership counts only if it AND its org are active, so
  soft-deleting a PARENT cascades the hidden state to its children for free. Adds
  `deleted_at is null` to the SELECT policies + partial indexes for the
  active-only reads. Only ever NARROWS visibility, so tenant isolation is
  unchanged; soft-delete writes go through `service_role`. Hard-delete FKs are
  kept for genuine purges; `users` is deferred.
- `20260610000002_input_length_limits.sql` — CHECK constraints bounding
  user-supplied text at the DB layer (security review M1/L2): `messages.content`
  ≤4000 chars, `organizations.name` / `roles.name` / `users.display_name` ≤200,
  each also requiring at least one non-whitespace char (so empty/whitespace-only
  values are rejected). Enforced in the DB because the chat composer posts
  straight to PostgREST with no server action to validate in — so the bound holds
  for every caller, including the service-role key. Idempotent.
- `20260610000003_remove_unused_users_invite.sql` — deletes the `users.invite`
  permission (security review L3). It was seeded and granted to every Member role
  but checked NOWHERE; `members.manage` is the real gate for member management,
  including the privileged add-user path. Wiring it instead would have let
  ordinary members reach that path, so it is removed. Cascades its
  `role_permissions` rows away; forward-only (the original seeding migration is
  left intact).
- `20260714000001_cortex_shell_tables.sql` — **Cortex super-app core** shell
  tables (additive): `app_definitions` (global tool catalog, authenticated-
  readable), `app_instances` (owned/placed instances; polymorphic `owner_id`,
  nullable `org_id`), `events` (event-bus log), `ai_log` (data-layer audit
  trail). RLS follows the Cortex Standard §6 SELECT pattern (`owner_id =
  auth.uid()` OR member of `org_id`, via `auth_user_is_member_of`); shell writes
  go through `service_role` (no client write policies yet). See `SCHEMA.md`
  "Cortex Shell Tables" and `packages/cortex-core`.
  **`app_instances` and its policy were superseded by `20260716000002`**
  (`app_definitions`, `events`, `ai_log` stand as described).
- `20260714000002_inventory_items.sql` — **Cortex Inventory tool** table
  (additive): the first tool table, with the three mandatory fields
  (`instance_id`, `owner_id`, `org_id`), indexes on the isolation fields, and RLS
  (SELECT via `auth_user_is_member_of`; writes `service_role`-only until Cortex
  auth lands — `memberships` has no `role` column for §6's owner/manager check).
  See ARCHITECTURE.md #30. **Superseded by `20260716000002`**, which drops and
  rebuilds this table org-scoped; the hand-maintained `schema.sql` duplicate it
  mirrored is deleted — the migration is the single source of truth.
- `20260716000001_organization_hierarchy.sql` — **organization hierarchy**
  (additive): `organizations.parent_id` (nullable = root; `on delete restrict`,
  so children must be re-parented/deleted first) + a no-cycle `BEFORE
  INSERT/UPDATE` trigger, and the tree-aware `auth_user_is_member_of_tree`
  helper — membership inherits DOWNWARD only (a parent's member reaches
  descendants; a child's member never reaches ancestors), active-only walk,
  depth-capped at 32. No policy rewiring: every existing policy still calls the
  flat `auth_user_is_member_of`, so visibility is unchanged.
- `20260716000002_cortex_org_tree_model.sql` — **Cortex reshaped onto the org
  tree** (DESTRUCTIVE; both tables were verified EMPTY first). Drops and rebuilds
  `app_instances` (polymorphic `owner_type`/`owner_id` gone — `owner_id` is now a
  real FK to `users`; `org_id` is NOT NULL, since every user has a personal org)
  and `inventory_items` (`instance_id` gone — tabs/branches are CHILD ORGS, not
  instances; adds `visibility in ('private','org','restricted')`). Re-adds the
  `events.emitted_by_instance` / `ai_log.target_instance_id` FKs that the cascade
  orphaned, same `ON DELETE SET NULL`; those audit columns survive. RLS SELECT is
  rebuilt on `auth_user_is_member_of_tree(org_id)` — the old `owner_id =
  auth.uid() OR is_member(org)` is deliberately NOT reproduced (that OR let a
  departed member keep reading; membership is now a blocking AND). Inventory
  admits only `visibility = 'org'` — 'private'/'restricted' are unreadable until
  `record_grants` lands (fail closed). Writes stay `service_role`-only; `events`
  and `ai_log` policies untouched.

## Usage

```typescript
import { createBrowserDbClient, createServerDbClient } from "@platform/db";
```

These are framework-agnostic factories over `@supabase/ssr`. Apps supply the
URL, key, and (server-side) a cookie adapter — see `apps/web/src/lib/supabase/`.

## Seeding test data (development only)

`scripts/seed.ts` populates the linked Supabase project with fictional data so
you can develop and demo tenant isolation by logging in as different org admins.

It seeds **2 organizations** (Organization A, Organization B), each with **5
users** (2 admins + 3 members), an **Admin** role (`is_admin = true`) and a
**Member** role (granted `users.view`), plus real Supabase
**auth users** + their `public.users` profiles, memberships, and role
assignments. It also seeds one **platform owner** (super admin),
`owner@platform.test`, flagged in `platform_admins` and belonging to **no**
organization.

```bash
pnpm seed                       # from the repo root
# or
pnpm --filter @platform/db seed
```

Requirements & safety:

- Reads `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` from the root
  `.env`. The **secret (service-role) key** is required because the script
  bypasses RLS to insert data. It is **server-side only** and never used by the
  web app.
- **Idempotent**: clears previously-seeded data first (seed orgs by name plus
  auth users on the seed domains `@organizationa.com`/`@organizationb.com` and
  the legacy `.test` suffix), so it is safe to re-run.
- Prints the **target project URL** before running and refuses to run with
  `NODE_ENV=production` (override with `SEED_FORCE=1`).
- Prints a **login credentials table** at the end.

All test users share the password **`123456`**. The emails use `.com` but are
fake/non-deliverable (we use email+password, not magic links).

| Email | Password | Organization | Role |
|---|---|---|---|
| admin1@organizationA.com | 123456 | Organization A | Admin |
| admin2@organizationA.com | 123456 | Organization A | Admin |
| user1@organizationA.com | 123456 | Organization A | Member |
| user2@organizationA.com | 123456 | Organization A | Member |
| user3@organizationA.com | 123456 | Organization A | Member |
| admin1@organizationB.com | 123456 | Organization B | Admin |
| admin2@organizationB.com | 123456 | Organization B | Admin |
| user1@organizationB.com | 123456 | Organization B | Member |
| user2@organizationB.com | 123456 | Organization B | Member |
| user3@organizationB.com | 123456 | Organization B | Member |
| owner@platform.test | 123456 | — (no org) | Platform Owner (super admin) |
