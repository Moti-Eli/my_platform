# Auth / Permissions / DB Layer — Inventory

Read-only inventory of the authentication, RBAC/permissions, and database layer,
produced for review. Nothing was modified. Paths are repo-relative.

The model in one line: **organizations are tenants → a user's roles live on their
`membership` (user+org) → roles grant `permissions` → tenant isolation is enforced
by Postgres RLS via `SECURITY DEFINER` helper functions in the `private` schema →
action-level permission checks live in `@platform/auth` + a few RLS write
policies.** Platform owners (super admins) sit above all orgs and are server-side
only.

---

## 1. SQL migrations / schema files

All under `packages/db/supabase/migrations/` (applied via `supabase db push`),
plus one in-app mirror. Listed in apply order.

| Path | What it does |
| --- | --- |
| `packages/db/supabase/migrations/20260605000001_core_rbac_schema.sql` | STEP 1 — core RBAC tables (`organizations`, `users`, `memberships`, `roles`, `permissions`, `role_permissions`, `membership_roles`), indexes, composite FKs for same-org integrity, and seeds 4 permissions. No RLS yet. |
| `packages/db/supabase/migrations/20260605000002_enable_rls_tenant_isolation.sql` | STEP 2 — creates the `private` schema + 3 `SECURITY DEFINER` helpers, enables RLS on all core tables, and adds SELECT policies (tenant isolation only). Writes left unpolicied = denied. |
| `packages/db/supabase/migrations/20260608000001_allow_public_read_permissions.sql` | Makes the global `permissions` catalog readable by `anon` (used by the landing-page health check). Only that one reference table; isolation elsewhere unchanged. |
| `packages/db/supabase/migrations/20260608000002_grant_service_role_privileges.sql` | Grants `service_role` full DML on the `public` schema (current + future objects) so server-side/admin ops work. `anon`/`authenticated` not broadened. |
| `packages/db/supabase/migrations/20260608000003_membership_roles_write_policy.sql` | First WRITE path: adds `private.auth_user_has_permission(org, key)` and INSERT/UPDATE/DELETE RLS policies on `membership_roles` gated on `members.manage`. |
| `packages/db/supabase/migrations/20260609000001_platform_admins_super_admin.sql` | Platform-owner layer: `platform_admins` table (RLS deny-all + REVOKE from clients; service_role only) and `public.auth_user_is_platform_owner()` RPC. |
| `packages/db/supabase/migrations/20260609000002_messages_org_chat.sql` | `messages` table (org chat) + RLS: read = org member; insert = org member AND `sender_id = auth.uid()` (anti-forgery). Immutable (no update/delete). |
| `packages/db/supabase/migrations/20260609000003_messages_realtime_publication.sql` | Adds `messages` to the `supabase_realtime` publication. Realtime Postgres Changes adhere to the SELECT RLS, so cross-org delivery is impossible. |
| `packages/db/supabase/migrations/20260609000004_tighten_client_role_grants.sql` | Defense-in-depth: revokes `TRUNCATE/TRIGGER/REFERENCES` from `anon`/`authenticated` on all current tables and via default privileges for future ones. |
| `packages/db/supabase/migrations/20260609000005_last_admin_db_guard.sql` | `private.enforce_org_keeps_admin()` + deferred constraint trigger on `membership_roles`: rejects any op leaving an existing org with zero admins (fires even for service_role). |
| `packages/db/supabase/migrations/20260609000006_membership_roles_covering_indexes.sql` | Covering indexes for the two `membership_roles` composite FKs; drops the now-redundant single-column role index. |
| `packages/db/supabase/migrations/20260609000007_messages_sender_id_index.sql` | Covering index on `messages.sender_id` FK. |
| `packages/db/supabase/migrations/20260610000001_soft_deletes.sql` | Adds `deleted_at` to `organizations`/`memberships`/`messages`, makes the membership helpers `deleted_at`-aware, adds `private.org_is_active()`, narrows SELECT policies. |
| `packages/db/supabase/migrations/20260610000002_input_length_limits.sql` | CHECK constraints bounding user text (messages.content ≤4000; org/role name, display_name ≤200) and forbidding empty/whitespace-only. DB-level (bypass-proof). |
| `packages/db/supabase/migrations/20260610000003_remove_unused_users_invite.sql` | Deletes the unused `users.invite` permission (checked nowhere; cascades its role grants). |
| `packages/db/supabase/migrations/20260714000001_cortex_shell_tables.sql` | Additive Cortex shell tables: `app_definitions`, `app_instances`, `events`, `ai_log` + RLS (own/org read; writes service_role-only). |
| `packages/db/supabase/migrations/20260714000002_inventory_items.sql` | First Cortex tool table `inventory_items` (three mandatory fields instance_id/owner_id/org_id) + own/org SELECT RLS; writes service_role-only. |
| `apps/cortex/src/tools/inventory/schema.sql` | In-app canonical mirror of the `inventory_items` DDL (kept in sync with the migration above). Not applied directly. |

Seed / provisioning (not migrations, but they populate the auth model):

| Path | What it does |
| --- | --- |
| `packages/db/scripts/seed.ts` | Dev seed (service_role key). Creates 2 orgs, Admin+Member roles, users, and the dev platform owner (`owner@platform.test`, only via service_role into `platform_admins`). Idempotent. |

---

## 2. Tables, roles, memberships, organizations + their RLS policies

Defined in `20260605000001` (tables) and `20260605000002` (RLS), narrowed by
`20260610000001` (soft delete). Summary of the access rules:

| Table | RLS SELECT policy | Write policies |
| --- | --- | --- |
| `public.organizations` | member of the org AND `deleted_at is null` | none (service_role only) |
| `public.users` | self OR shares an org with the target user | none |
| `public.memberships` | self OR member of the org; org + row active | none |
| `public.roles` | member of the role's org | none |
| `public.permissions` | `true` (global catalog; `anon`+`authenticated`) | none |
| `public.role_permissions` | parent role is in one of the user's orgs | none |
| `public.membership_roles` | member of the row's org | INSERT/UPDATE/DELETE gated on `members.manage` in the row's org (`20260608000003`) |
| `public.messages` | org member AND `deleted_at is null` | INSERT: org member AND `sender_id = auth.uid()`; no update/delete |
| `public.platform_admins` | **none** (RLS deny-all + REVOKE from clients) | none for clients; service_role only |
| `public.app_definitions` | `true` (authenticated) | none |
| `public.app_instances` | `owner_id = auth.uid()` OR member of `org_id` | none |
| `public.events` | `user_id = auth.uid()` OR member of `org_id` | none |
| `public.ai_log` | `user_id = auth.uid()` | none |
| `public.inventory_items` | `owner_id = auth.uid()` OR member of `org_id` | none (deferred until Cortex auth) |

Key integrity notes:
- `membership_roles` uses **two composite FKs** sharing one `organization_id`, so a
  role from org B can never be attached to a membership in org A (no cross-tenant
  privilege leak) — `20260605000001`.
- Roles are per-org **data**; `permissions` are global **code** (seeded). A role
  with `is_admin = true` implicitly holds all permissions.
- Writes across the schema are deny-by-default; only `membership_roles` and
  `messages` have client write policies. Everything else mutates server-side via
  `service_role`.

---

## 3. Postgres helper functions in the `private` schema

All are `SECURITY DEFINER`, `STABLE`, `SET search_path = ''` (search-path-hijack
hardened), granted `execute` to `authenticated` only, and used to break RLS
recursion. `anon` never gets `USAGE` on the schema.

| Function | File | What it does |
| --- | --- | --- |
| `private.auth_user_is_member_of(org_id)` | `...20260605000002` (soft-delete-aware in `...20260610000001`) | True if `auth.uid()` has an active membership in an active org. The workhorse of every org-scoped policy. |
| `private.auth_user_shares_org_with(user_id)` | `...20260605000002` / `...20260610000001` | True if caller shares an org with the target user (backs the `users` policy). |
| `private.auth_user_can_access_role(role_id)` | `...20260605000002` / `...20260610000001` | True if the role's org is one the caller belongs to (backs `role_permissions`, which has no org_id). |
| `private.auth_user_has_permission(org_id, permission_key)` | `...20260608000003` (soft-delete-aware in `...20260610000001`) | True if caller has an active membership in the org and a role there that is `is_admin` or grants `permission_key`. **The action-level permission check.** |
| `private.org_is_active(org_id)` | `...20260610000001` | True if the org exists and is not soft-deleted. |
| `private.enforce_org_keeps_admin()` | `...20260609000005` | Constraint-trigger fn: rejects ops leaving an existing org with zero admins. |

Note: `public.auth_user_is_platform_owner()` (`...20260609000001`) is deliberately
in the **`public`** schema (not `private`) so PostgREST can expose it as an RPC;
it returns only a boolean about the caller and never leaks the owner list.

---

## 4. Tests covering permissions / RLS

There are **no unit/`*.test.ts` files** for this layer. Coverage is a suite of
end-to-end **verification harnesses** that run against a real seeded Supabase
project (real RLS, real signed-in users). All under `packages/db/scripts/` except
the HTTP one under `scripts/`.

| Path | What it verifies |
| --- | --- |
| `packages/db/scripts/verify-add-member.ts` | `members.manage` gate: admin can add to own org; member rejected; cross-org rejected; duplicate email handled. |
| `packages/db/scripts/verify-platform-owner.ts` | Owner can create org+first admin; non-owner rejected; tenant isolation intact; no self-insert into `platform_admins`. |
| `packages/db/scripts/verify-messages.ts` | `messages` RLS: member insert/read own org; cross-org read/insert denied; sender-forgery denied. |
| `packages/db/scripts/verify-chat-realtime.ts` | Realtime tenant isolation over the live socket, including a tampered subscription filter that receives nothing. |
| `packages/db/scripts/verify-chat-http.ts` | Chat page server render + guard (HTTP smoke). |
| `packages/db/scripts/verify-last-admin.ts` | Last-admin DB trigger blocks even a direct service_role delete/demote; cascade org teardown still works. |
| `packages/db/scripts/verify-soft-delete.ts` | Soft-deleted org/membership/message hidden from RLS reads while rows persist; isolation unchanged. |
| `packages/db/scripts/verify-input-limits.ts` | Length/empty CHECK constraints reject bad input even via service_role. |
| `packages/db/scripts/verify-platform-http.ts` | `/platform` server-side guard: unauth→login, admin/member→dashboard, owner→200. |
| `packages/db/scripts/verify-observability.ts` | Logging redaction — that no secrets/passwords/tokens/keys/emails leak into logs. |
| `scripts/verify-admin-api.mjs` | Mobile-facing admin API routes: 401/403/409/400/405 paths + tenant isolation + provisioning. Reads config from `apps/web/.env.local`. |

---

## 5. Where permission strings are checked / enforced (TypeScript)

### `@platform/auth` — the RBAC resolver (`packages/auth/src/index.ts`)
- `getEffectivePermissions(supabase, userId, orgId)` — resolves the union of a
  membership's role permissions (admin role ⇒ all keys). The core resolver.
- `hasPermission(supabase, userId, orgId, key)` — boolean wrapper; **the primary
  app-layer permission gate.**
- `isPlatformOwner(supabase)` — calls the `auth_user_is_platform_owner` RPC; fails
  closed (false on error).
- `createOrganizationWithFirstAdmin(...)` — re-checks `isPlatformOwner` before any
  privileged write.
- `PermissionKey` type — compile-time mirror of catalog keys: `users.view` /
  `roles.manage` / `members.manage`.
- `NEW_ORG_MEMBER_PERMISSIONS = ["users.view"]` — baseline granted to a new org's
  Member role.

### Enforcement call sites

| File | Permission / check | What it guards |
| --- | --- | --- |
| `apps/web/src/lib/feature-guard.ts` | `isPlatformOwner`; `hasPermission(feature.requiredPermission)` | THE route access boundary for feature pages. `ownerOnly` → owner check; `requiredPermission` branch is **dormant** (no web feature sets it today). |
| `apps/web/src/lib/admin/add-member.ts` | `hasPermission(..., "members.manage")` in target org | Security boundary for adding a user (also enforces cross-org isolation) before the secret-key client is constructed. |
| `apps/web/src/lib/admin/create-organization.ts` | `isPlatformOwner` | Owner-only gate before the create-org+first-admin service_role flow. |
| `apps/web/src/lib/admin/list-organizations.ts` | `isPlatformOwner` | Owner-only gate before the cross-org service_role read. |
| `apps/web/src/app/[locale]/dashboard/members/actions.ts` | RLS (writes via authenticated client) + app-level last-admin guard | Role change: `membership_roles` writes are gated by the DB policy on `members.manage`; app also blocks demoting the last admin (friendly). |
| `apps/web/src/app/[locale]/dashboard/members/page.tsx` | `hasPermission(..., "members.manage")` | Decides `canManage` (show role selects / Add member). UX + reuses the guard. |
| `apps/web/src/app/[locale]/dashboard/chat/page.tsx` | `requireFeatureAccess("chat")` (authenticated only) | Chat page guard; reads/writes via authenticated client (RLS end-to-end). |
| `apps/web/src/app/api/admin/members/route.ts` | delegates to `add-member.ts` (`members.manage`) | Mobile-facing POST; Bearer-token → RLS client → re-check. |
| `apps/web/src/app/api/admin/organizations/route.ts` | delegates to create/list (`isPlatformOwner`) | Mobile-facing POST/GET; owner re-check server-side. |
| `apps/web/src/lib/admin/api-auth.ts` | validates Bearer token via `getUser(token)` | Builds a per-request RLS-scoped client for the admin API; rejects forged/expired tokens (401). |
| `apps/mobile/app/members.tsx` | `hasPermission(..., "members.manage")` | `canManage` UX + role-change via RLS client; add-user goes through the web admin API (server is the boundary). |
| `apps/mobile/app/platform.tsx` | `isPlatformOwner` | Client-side UX guard; the admin API re-verifies ownership server-side. |

### Cortex data layer (permission enforcement not yet wired)
- `apps/cortex/src/cortex/runtime.ts` — builds the `runIntent` "one door" and
  event bus, but currently on an **in-memory** DB with a fixed `DEV_CTX`
  (`apps/cortex/src/cortex/dev-ctx.ts`); no real auth/permission enforcement yet.
  Tool-table write policies and the owner/manager rule are deferred until Cortex
  auth lands (see migration headers for `inventory_items` / cortex shell).

---

## 6. Secrets / keys / credentials — FLAGGED (values NOT printed)

**Secret-bearing, correctly git-ignored (verified via `git check-ignore`; not tracked):**

| Path | Sensitive keys present (names only) | Notes |
| --- | --- | --- |
| `.env` | `SUPABASE_SECRET_KEY`, `API_SECRET`, `NEXT_PUBLIC_SUPABASE_*` | Root env; holds the service-role secret. Git-ignored. **Real secrets — do not commit.** |
| `apps/web/.env.local` | `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SUPABASE_*` | Web app runtime secret. Git-ignored. |
| `.env.local` | `VERCEL_OIDC_TOKEN` | Vercel-generated token. Git-ignored. |
| `apps/cortex/.env.local` | `VERCEL_OIDC_TOKEN` | Vercel-generated token. Git-ignored. |
| `apps/mobile/.env.local` | `EXPO_PUBLIC_*` only (publishable) | No server secret (correct — mobile must never hold the secret key). Git-ignored. |

**Templates / non-secret (git-tracked, placeholders only):**

| Path | Notes |
| --- | --- |
| `.env.example` | Documents all vars incl. `SUPABASE_SECRET_KEY`, `API_SECRET`, `SENTRY_DSN` as placeholders. Tracked; no real values. |
| `apps/mobile/.env.example` | `EXPO_PUBLIC_*` placeholders. Tracked; no real values. |

**Hard-coded dev credentials in source (intentional, dev-only, NODE_ENV-gated):**

| Location | What | Guard |
| --- | --- | --- |
| `apps/web/src/lib/admin/add-member.ts` (`DEV_TEMP_PASSWORD = "123456"`) | Temp password for newly created users | Production mints a random `randomBytes(24)` password instead (`NODE_ENV === "production"`). |
| `apps/web/src/lib/admin/create-organization.ts` (`DEV_TEMP_PASSWORD = "123456"`) | Temp password for first admin | Same NODE_ENV gate. |
| `packages/db/scripts/seed.ts` (`TEST_PASSWORD = "123456"`) | Shared password for all seeded test users; dev platform owner `owner@platform.test` | Refuses to run under `NODE_ENV=production` unless `SEED_FORCE=1`. |

**Secret handling in code (the only place the secret key is used app-side):**
- `apps/web/src/lib/supabase/admin.ts` reads `SUPABASE_SECRET_KEY` (no
  `NEXT_PUBLIC_` prefix, `import "server-only"`), returns `null` if unset. This
  client **bypasses RLS**; every caller re-checks authorization first.
- `@platform/db` client factories: `createBrowserDbClient` / `createServerDbClient`
  / `createTokenDbClient` (publishable key, RLS applies) vs `createAdminDbClient`
  (secret key, bypasses RLS) — `packages/db/src/index.ts`.

> No secret **values** are reproduced in this document. The `.env*` files that hold
> real secrets are all git-ignored and untracked; only `.env.example` /
> `apps/mobile/.env.example` (placeholders) are tracked.
