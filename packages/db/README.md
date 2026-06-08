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
**Member** role (granted `users.view`, `users.invite`), plus real Supabase
**auth users** + their `public.users` profiles, memberships, and role
assignments.

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
