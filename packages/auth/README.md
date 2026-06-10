# @platform/auth

Authentication + RBAC resolution, built on a Supabase client. **UI-agnostic** —
every function takes a `SupabaseClient` (created by the app via `@platform/db`),
so this package has no React/Next dependency and is reusable by web and mobile.

## Auth

- `signIn(supabase, email, password)` → `{ user, error }`
- `signOut(supabase)` → `{ error }`
- `getCurrentUser(supabase)` → `User | null`

## RBAC resolution

A user's roles live on their **membership** in an organization. Effective
permissions = the union of permissions across all roles on that membership; a
role with `is_admin` implies **all** permissions. (See `packages/db/SCHEMA.md`.)

- `getUserOrganizations(supabase, userId)` → `UserOrganization[]`
  (each: `{ organizationId, organizationName, roles: { id, name, isAdmin }[] }`)
- `getOrganizationMembers(supabase, orgId)` → `OrgMember[]`
  (each: `{ membershipId, userId, email, displayName, joinedAt, roles }`)
- `getEffectivePermissions(supabase, userId, orgId)` → `string[]` (permission keys)
- `hasPermission(supabase, userId, orgId, permissionKey)` → `boolean`

These run as the **current user**, so RLS guarantees they only ever see that
user's own data (tenant isolation is enforced by the database, not here).

## Platform owner (super admin) — server-side

An access level **above** org admins (see `packages/db/SCHEMA.md`). Owner status
lives in the sealed `platform_admins` table; super-admin power is **server-side
only** (no cross-org RLS), so these need a privileged service-role client.

- `isPlatformOwner(supabase)` → `boolean` — calls the
  `auth_user_is_platform_owner()` RPC (reports only on the caller).
- `createOrganizationWithFirstAdmin(actingClient, serviceClient, input)` →
  `{ error, organizationId, adminUserId }` — onboards a new client org. Re-checks
  the acting user is a platform owner **before** using `serviceClient` (the
  secret/service-role key, server-side only), then atomically creates the org +
  Admin/Member roles + first admin (auth user + profile + membership + admin
  role), rolling everything back on any failure.

## Usage

```typescript
import { getCurrentUser, hasPermission } from "@platform/auth";

const user = await getCurrentUser(supabase);
if (user && (await hasPermission(supabase, user.id, orgId, "members.manage"))) {
  // ...allowed
}
```

In `apps/web`, the Supabase client comes from `src/lib/supabase/server.ts`
(server) or `client.ts` (browser), both wrapping `@platform/db` factories.
