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

## Self-service signup — server-side

Public registration, the counterpart to `createOrganizationWithFirstAdmin` but
with **no acting user and no authorization gate**: the call is what creates the
user's identity, so there is nothing to authorize yet. Server-side only.

- `signUpWithNewOrganization(serviceClient, input)` →
  `{ error, userId, organizationId }` — where `input` is
  `{ email, password, displayName, organizationName }`. Uses **only** the
  service-role client (required: `organizations`/`memberships` have SELECT-only
  RLS with no INSERT policy). Atomically creates the org + Admin/Member roles +
  the auth user + profile + membership + Admin role (the signup user owns the org
  they create), rolling everything back on any failure. `error` is `null` on
  success or one of `invalidEmail | invalidName | invalidOrgName |
  invalidPassword | emailExists | createFailed`.

## Self-service org membership (current user) — server-side

Lifecycle seams the **logged-in user** runs on their own orgs. Same two-client
split as above (`actingClient` = the actor's JWT for the RLS-scoped checks;
`serviceClient` = service-role for the privileged write). See the docstrings in
`src/index.ts` for the full reasoning.

- `createOrganizationForCurrentUser(actingClient, serviceClient, input)` →
  `{ error, organizationId }` — spins up a new **root** org and makes the caller
  its first admin.
- `hideOrganizationForCurrentUser(actingClient, serviceClient, input)` →
  `{ error }` — **soft-deletes the ORG** (`organizations.deleted_at`). Solo orgs
  only; refuses on `cannotHideLastOrg` / `orgHasOtherMembers`.
- `leaveOrganizationForCurrentUser(actingClient, serviceClient, input)` →
  `{ error }` where `input` is `{ organizationId }` — the **complement of hide**:
  soft-deletes just the **caller's MEMBERSHIP** (`memberships.deleted_at`), so the
  org survives for everyone else. Reversible (role rows are left intact). `error`
  is `null` on success or one of `notAllowed | cannotLeaveLastOrg |
  lastAdminMustHandOff | leaveFailed`. Enforces the last-admin invariant **in the
  seam**, because a membership soft-delete never touches `membership_roles` and so
  the DB last-admin guard cannot fire. Verified by
  `packages/db/scripts/verify-leave-org.ts`.

  > v1 limitation — no rejoin: `addMemberToOrg` cannot re-add a user whose
  > membership was soft-left (the `(user_id, organization_id)` unique constraint
  > rejects the INSERT, surfacing as `alreadyMember`). Rejoining requires
  > un-hiding the membership (clearing `deleted_at`), which is not yet supported.

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
