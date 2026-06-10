# Architecture Decisions

This document records key architectural decisions and the reasoning behind them.

## 1. Monorepo with Turborepo + pnpm

**Decision:** Use Turborepo for orchestration and pnpm for workspace management.

**Reasoning:** A monorepo enables code sharing (types, utilities, auth logic, design tokens) across web and mobile platforms while maintaining clear package boundaries. Turborepo optimizes task execution with intelligent caching and parallelization. pnpm reduces disk space and installation time compared to npm/yarn, making development faster. This combination is used by major projects (Vercel, Next.js) and has proven scalability.

---

## 2. Separate UI per Platform, Shared Design Tokens

**Decision:** Create platform-specific apps (Next.js for web, Expo for mobile) with a shared `@platform/ui` component library and `@platform/config` for design tokens.

**Reasoning:** Web and mobile have different UI frameworks and constraints. Rather than force a single component library, each platform gets optimized implementations (React for web, React Native for mobile). Sharing design tokens (colors, spacing, typography) ensures visual consistency across platforms without forcing code reuse where it doesn't fit. This approach balances DRY principles with platform-specific best practices.

---

## 3. Role-Based Access Control (RBAC) Over Hardcoded Roles

**Decision:** Implement RBAC in `@platform/auth` as the foundation, allowing dynamic role and permission definitions.

**Reasoning:** Hardcoding roles (admin, user, etc.) into the codebase creates brittleness: every new role or permission change requires code redeploy. RBAC decouples permissions from code, allowing business teams to manage roles without engineering involvement. This scales better as the platform grows across multiple business domains with varying permission models.

---

## 4. Secrets via Environment Variables, Not Committed Code

**Decision:** Store all secrets (Supabase keys, API tokens) in `.env` files (gitignored) or CI/CD platform secrets.

**Reasoning:** Committing secrets to version control (even to a private repo) is a major security vulnerability. Using environment variables at runtime, loaded from `.env` in development and from CI/CD platforms in production, ensures secrets never touch source control. The `.env.example` file documents required variables without exposing values.

---

## 5. TypeScript Strict Mode Everywhere

**Decision:** Enable `strict: true` in `tsconfig.strict.json` and extend it across all packages.

**Reasoning:** Strict mode catches entire categories of bugs at compile time (null/undefined, implicit any, unused variables). While it requires more upfront type annotations, it dramatically reduces runtime errors and improves code maintainability. This is especially important in a monorepo where code is shared across multiple applications.

---

## 6. Conventional Commits with Husky Hooks

**Decision:** Use Conventional Commits format with commitlint and husky to enforce commit standards and run checks.

**Reasoning:** Conventional Commits create a human-readable, machine-parseable commit history that enables automated changelog generation, semantic versioning, and better collaboration. Husky pre-commit hooks run linting and type checks before commits, preventing broken code from reaching main branch. This scales well as the team grows.

---

## 7. GitHub Template Repository for Spawning Projects

**Decision:** This repository can be marked as a GitHub template to spawn new projects with all infrastructure ready.

**Reasoning:** Onboarding new projects or teams is often slow due to boilerplate setup. Using this as a template means new projects start with production-ready infrastructure (monorepo structure, configs, CI/CD hooks) immediately, without reinventing the wheel. Reduces setup friction from days to minutes.

---

## 8. Turborepo Pipeline Configuration

**Decision:** Define `build`, `lint`, `typecheck`, and `dev` pipelines in `turbo.json`.

**Reasoning:** Explicit pipeline configuration makes task dependencies clear and enables Turborepo's caching and parallelization. Developers understand what tasks run and in what order. CI/CD can reuse the same pipeline configuration, reducing duplication and ensuring consistency between local and remote environments.

---

## 9. pnpm Workspaces for Monorepo Management

**Decision:** Use pnpm's native workspace feature instead of Lerna or Yarn workspaces.

**Reasoning:** pnpm workspaces are simpler than Lerna (no extra abstraction layer), more efficient than Yarn (stricter node_modules structure), and have become the industry standard for modern monorepos. pnpm's strict module resolution catches accidental dependencies that Yarn/npm would allow, leading to better package hygiene.

---

## 10. Multi-Tenant RBAC with Roles on the Membership

**Decision:** Model tenancy around `organizations`, link users to orgs via a
`memberships` table, and attach a user's roles to that membership (not to the
user). Roles are per-organization, editable *data*; permissions are global,
code-defined, seeded values. Effective access = union of permissions across a
membership's roles (admin role implies all). Every org-scoped table carries
`organization_id`.

**Reasoning:** Putting roles on the membership lets one person be an admin in
org A and read-only in org B without duplicating identities, which is essential
for a platform serving many independent tenants. Separating editable roles
(data) from fixed permissions (code) lets each org's admins manage their own
roles safely while engineers retain control over the atomic actions the app
enforces. A uniform `organization_id` column is the key RLS will later use to
guarantee tenant isolation at the database level.

**Same-organization integrity enforced in the schema.** The
`membership_roles` join carries its own `organization_id` and references both
parents through composite foreign keys (`(membership_id, organization_id)` and
`(role_id, organization_id)`). Sharing one `organization_id` value across both
keys makes it physically impossible to attach one org's role to another org's
membership — a cross-tenant privilege leak. We deliberately enforce this in the
database rather than trusting application code.

**Multiple admin roles allowed.** `is_admin` may be true on more than one role
per organization; a generic platform should not cap admin roles. The "never
leave an org with zero admins" guard belongs in application logic, not a schema
restriction.

**Status / sequencing:** Delivered in steps. Step 1 (this milestone) adds the
core tables, indexes, and seed permissions with **no RLS**, and was applied to
the Supabase cloud project on 2026-06-05 (migration `20260605000001`). Row
Level Security is deliberately deferred to a separate, individually-reviewed
migration so the access-control rules can be audited in isolation. Until RLS
lands, tenant isolation is not enforced by the database. See
`packages/db/SCHEMA.md`.

---

## 11. RLS for Tenant Isolation; Action Permissions in the App Layer

**Decision:** Use Postgres Row Level Security as the database-level guarantee of
**tenant isolation** — a user can only read rows belonging to organizations they
are a member of — and keep **action-level permission checks** (who may invite,
edit roles, delete, etc.) out of RLS, deferring them to `@platform/auth`.
Membership checks inside policies are implemented via `SECURITY DEFINER` helper
functions in a private, non-API-exposed schema, marked `STABLE` with
`SET search_path = ''`.

**Reasoning:** RLS is the right place for "which org's data can I see" because
it enforces isolation even if application code is buggy — the strongest possible
boundary between tenants. It is the *wrong* place for "what am I allowed to do",
which is richer, changes often, and is better expressed as explicit permission
checks in the auth layer; baking that into SQL policies would couple isolation
to business rules and make both brittle. The `SECURITY DEFINER` helpers are
required to avoid the classic RLS **infinite-recursion** footgun: a membership
policy that re-queries `memberships` would recurse, so the lookup runs in a
function whose owner privileges bypass RLS. `search_path = ''` plus full schema
qualification closes the SECURITY DEFINER search-path-hijack vulnerability.

**Status / sequencing:** Applied to the Supabase cloud project (migration
`20260605000002`). **SELECT policies only** for now; INSERT/UPDATE/DELETE remain
unpolicied (therefore denied for normal users) until `@platform/auth` defines
the action-level model. Server-side code using the secret key runs as
`service_role` and bypasses RLS. See `packages/db/SCHEMA.md`.

---

## 12. Web App: Next.js App Router, next-intl, Token-Driven Theming, @supabase/ssr

**Decision:** Build `apps/web` on **Next.js (App Router, latest stable — v16)**
with TypeScript strict, consuming the shared `@platform/*` packages via
`transpilePackages` (the packages ship raw TS, no build step). Four sub-decisions:

- **i18n with next-intl, locale-prefixed routing.** Routes are prefixed
  (`/he`, `/en`) with `he` as the default; `<html dir>` is derived from the
  locale (RTL for Hebrew). Translations and the locale list live in
  `@platform/i18n` as the single source of truth — apps never copy translations.
- **Token-driven theming via CSS variables.** `@platform/config` emits CSS
  variables for each theme from the design tokens; Tailwind v4 utilities are
  mapped (`@theme inline`) onto those variables. Switching themes is just
  toggling `data-theme` on `<html>`. The choice is stored in a **cookie** and
  applied **server-side**, so the first paint is correct (no flash, no hydration
  mismatch) — chosen over `localStorage`, which is unavailable during SSR.
- **@supabase/ssr for auth-ready data access.** Cookie-based browser and server
  clients (the current Supabase App Router pattern). The factories live in
  `@platform/db` and are **framework-agnostic** (the server one takes a cookie
  adapter), so the package never imports `next/*` — apps depend on packages, not
  the reverse.
- **Theming/i18n state is server-derived.** Locale comes from the URL; theme
  from a cookie. Both are read on the server so rendering is deterministic.

**Reasoning:** The App Router is the current Next.js default and the only
actively developed model. Putting locales/messages/tokens in shared packages
keeps web and (future) mobile consistent and avoids duplication, honoring the
monorepo philosophy. Cookie-based theme + server rendering is the clean,
SSR-correct way to avoid the theme/RTL flash that plagues client-only
approaches. Keeping the Supabase factories framework-agnostic preserves package
boundaries and lets mobile reuse them later.

**Notes:** Next.js 16 raised the floor to **Node ≥ 20.9**, made Turbopack the
default bundler, renamed the `middleware` convention to `proxy`, and removed
`next lint` (we lint with ESLint flat config + `@next/eslint-plugin-next`
directly). The home page's Supabase health check reads the global `permissions`
catalog; to support that public read, the catalog was made anon-readable
(migration `20260608000001`) — tenant data remains members-only.

---

## 13. Authentication via Supabase + @supabase/ssr; RBAC Resolution in @platform/auth

**Decision:** Use Supabase email/password auth with the `@supabase/ssr`
cookie-based session pattern for the Next.js App Router. The auth/RBAC *logic*
lives in `@platform/auth` as **UI-agnostic functions that take a Supabase
client** (`signIn`, `signOut`, `getCurrentUser`, `getUserOrganizations`,
`getEffectivePermissions`, `hasPermission`). Effective permissions are resolved
as the union of permissions across all roles on the user's membership in an org,
with an `is_admin` role implying all permissions.

**Route protection:** the proxy (`@supabase/ssr` session refresh, composed with
next-intl) keeps tokens fresh, but the actual guard is enforced **in the
protected server component** via `getCurrentUser` (redirect to login if absent).
We never rely on middleware alone for protection — middleware can be bypassed
and runs before the data layer; the server-side check is authoritative.

**Reasoning:** Keeping auth/RBAC as client-injected functions (no `next/*` or
React imports) means mobile can reuse the exact same logic later — honoring the
monorepo philosophy. `@supabase/ssr` is the current, supported way to do
cookie-based SSR auth in the App Router. Resolving permissions in the app layer
(rather than in SQL/RLS) keeps RLS focused purely on tenant isolation (decision
#11) while permission *checks* — which are richer and change often — live in
code. Because these helpers run as the current user, RLS automatically scopes
every query to that user's data, so the resolution can't leak across tenants.

**Login flow:** a server action calls `signIn` (which sets the session cookies
server-side) then redirects to the dashboard; errors are returned as i18n keys
and rendered translated (he/en). Logout is a server action calling `signOut`.

**Browser-back on the login page:** the normal landing → login → back path works
(login is served `200`; every "Sign in" link is locale-prefixed, so no bare
`/login` 307 enters history). The one case where the browser back button appears
"stuck" on `/login` is the *auth-redirect trap*: after logout (or session
expiry) you're sent to login, and pressing Back returns to a protected page whose
server-side guard immediately re-redirects to login (on client navigation this
arrives as a `REDIRECT` directive in the RSC payload, applied as a history
replace). This is **intentional** — being able to navigate Back into a protected
page after logout would be a security regression — so we do not weaken the guard.
The login page instead always offers a reliable way out via a home wordmark and
an explicit "back to home" link.

---

## 14. Permission-Checked Write Policies (DB-Enforced Authorization)

**Decision:** Open up writes **one path at a time**, each gated by an RLS policy
that calls a `SECURITY DEFINER` helper to check the acting user's *permission* in
the row's organization — so authorization for mutations is enforced at the
database level, not only in app code. The first such path is `membership_roles`
(assign/unassign a member's roles), gated by the `members.manage` permission via
`private.auth_user_has_permission(org_id, permission_key)`.

**Reasoning:** RLS already guarantees tenant isolation (decision #11); this
extends the same database-level guarantee to *who may write what*. Even if the
app layer has a bug or is bypassed, the database refuses unauthorized writes. We
follow Postgres/Supabase conventions: INSERT uses `WITH CHECK`, DELETE uses
`USING`, UPDATE uses both; the permission helper is recursion-safe (SECURITY
DEFINER bypasses RLS on the joined tables), `STABLE`, and `search_path`-locked,
matching our read helpers. RLS gates rows, so the role also receives the DML
**table grant** (`authenticated` gets INSERT/UPDATE/DELETE on `membership_roles`
only). Opening one table at a time keeps each authorization decision reviewable.

**Org isolation:** the policy keys on the row's `organization_id`, and the
composite foreign keys from Step 1 prevent that id from being spoofed to another
org — so `members.manage` in org A cannot mutate `membership_roles` in org B
(verified end-to-end as seeded users).

**Guardrail (revisit):** `members.manage` is currently granted only to admin
roles, so only admins can (re)assign roles and a member cannot self-escalate. If
that permission ever becomes grantable to non-admins (e.g. via a future admin
UI), add explicit guards — forbid removing an org's last admin, forbid
self-escalation — in app logic and/or stricter policies before doing so.

---

## 15. Permission-Aware UI (Ask "Is This Allowed?", Not "Is This an Admin?")

**Decision:** UI that gates privileged actions asks the permission system —
`hasPermission(user, org, 'members.manage')` from `@platform/auth` — rather than
checking `isAdmin` directly. The member-management screen shows role-editing
controls only when that permission is present; otherwise it renders read-only.
The write itself goes through the **authenticated** Supabase client so **RLS is
the real enforcer** — the UI gating is UX, not the security boundary.

**Reasoning:** Keying UI on permissions (not roles) is what makes the RBAC model
generic: when permissions later become editable per-org, the same screen adapts
with no code change, and a non-admin role granted `members.manage` would simply
see the controls. Crucially, hiding controls is never trusted for security — a
member who forges a request is still denied by the RLS write policy (decision
#14), which we verified end-to-end. The web app only ever uses the publishable
(anon) key; the secret key is never shipped to the client.

**Last-admin guard:** preventing an org from being left with zero admins is
enforced at **two layers**. The server action still counts admins before
demoting (fast UX feedback), but the real boundary is now in the **database**: a
deferrable constraint trigger on `membership_roles`
(`membership_roles_keep_org_admin`, migration `20260609000005`) rejects any
DELETE/UPDATE that would strip an existing org's last `is_admin` assignment —
verified to hold even against a direct `service_role` call, while still allowing
legitimate org/user cascade teardown (it evaluates the transaction's final state
at commit). See `packages/db/SCHEMA.md`.

---

## 16. Server-Side Privileged User Creation (Secret Key, Permission-Checked)

**Decision:** Adding a brand-new user to an organization (create the Supabase
auth user + `public.users` profile + membership + initial role) runs in a
**server action** using the **secret/service-role key**, because it must create
an `auth.users` row — an operation RLS/anon cannot perform. The secret key is
reached only through a single `server-only` module
(`apps/web/src/lib/supabase/admin.ts` → `@platform/db` `createAdminDbClient`),
and the action authorizes the request *before* touching that client by
re-checking `hasPermission(authClient, user.id, orgId, 'members.manage')` with
the **authenticated** (RLS-scoped) client.

**Reasoning:** This is the deliberate, narrow exception to "the web app only
uses the anon key" (decision #15): user creation genuinely needs elevated
privilege, so it is isolated server-side and fenced off from the client. The
`server-only` import makes an accidental client import a **build error**, and
the env var has no `NEXT_PUBLIC_` prefix, so Next.js can never inline it into a
client bundle (verified: the key is absent from `.next/static`). Authorization
is **never** trusted from the client — hiding the "Add user" button is UX, while
the server-side `hasPermission` re-check is the security boundary. That same
check **also enforces tenant isolation for the create**: `hasPermission` returns
false unless the acting user has a `members.manage` membership in the *target*
org, so an Org A admin cannot create users in Org B. Creation is **atomic-ish** —
the auth user is created first and, if any later insert fails, it is deleted
again (FK `ON DELETE CASCADE` removes the profile/membership/role), so a failure
never leaves a half-provisioned user.

**Note — why not a DB write policy (like #14)?** `membership_roles` writes are
gated in the database because both anon and service paths touch the same table.
User creation is different: it *requires* `service_role` to make the `auth.users`
row, so the authorization check lives in the server action (app layer), with the
secret key confined to `server-only` code. The created member's roles still flow
through the same `membership_roles` table whose composite FKs guarantee
same-org integrity.

**Dev shortcut, fenced off from production:** in development new users get a
known temporary password (`123456`, matching the seed) so the demo can log in
immediately. In production that known password is **never** used — it would be a
backdoor — so `newUserPassword()` falls back to a cryptographically random,
never-disclosed password (`NODE_ENV` gate), and the in-app "temp password" hint
is hidden. A real deployment must still wire an email invite / magic link or a
forced reset on first login before this is user-facing (flagged in
`packages/db/SCHEMA.md`); the random-password fallback only guarantees no
backdoor exists in the meantime. The duplicate-email path returns a friendly
translated error; because the action is admin-gated, the resulting
registration-status disclosure is limited to trusted admins.

---

## 17. Platform-Owner (Super Admin) Layer — Server-Side Cross-Org Provisioning

**Decision:** Introduce an access level **above** organization admins — the
**platform owner** — who onboards new client organizations (create org + first
admin). Owner status lives in a dedicated, fully-sealed `platform_admins` table
(PK → `auth.users`), checked by a `public.auth_user_is_platform_owner()`
`SECURITY DEFINER` RPC. Crucially, super-admin power is **server-side only**: we
add **no** cross-org RLS policies (approach (b)); every super-admin operation
runs through the **service-role key** behind an app-level owner re-check
(`createOrganizationWithFirstAdmin` in `@platform/auth`, with rollback).

**Reasoning:** This layer sits *above* tenant isolation, so it is the most
security-sensitive construct in the system and is designed to minimize blast
radius. A dedicated table (not a boolean on `users`) is explicit, auditable, and
gets its own sealed surface. **No-self-assignment is guaranteed** by RLS-enabled
+ zero-policies + `REVOKE ALL` from `anon`/`authenticated`: the publishable key
has no privilege on the table at all, so the *only* way to mint an owner is
server-side as `service_role` (us, via migration/seed). We chose approach (b)
over widening client-facing RLS with `OR auth_user_is_platform_owner()` because
(b) leaves tenant isolation **byte-for-byte unchanged** — an owner gains zero
extra power through their normal session, and a stolen owner JWT cannot read
cross-org via the public API (you'd need the server-only secret key). The cost —
super-admin features must be server actions — is appropriate for an onboarding
tool. Verified end-to-end (15/15): owner creates an org whose first admin then
sees/manages only that org; a non-owner is rejected server-side; existing
isolation (Org A ⇎ Org B, member cannot write roles) is unchanged; and no client
path can insert into `platform_admins`.

**Accepted advisor findings:** the security advisor reports two new, intended
findings — INFO `rls_enabled_no_policy` on `platform_admins` (that *is* the
sealed table) and WARN `authenticated_security_definer_function_executable` on
the owner-check RPC. The latter is reviewed as safe: the function is parameterless
and returns only the caller's own boolean (no enumeration), and `SECURITY
DEFINER` is required to read the sealed table; granting `authenticated` execute
is deliberate. See `packages/db/SCHEMA.md`.

**Dev shortcut (same caveat as #16):** the dev seed marks `owner@platform.test`
with `123456`, and `createOrganizationWithFirstAdmin` takes the first admin's
password from its caller. The super-admin UI's create action uses the same
`NODE_ENV` gate as add-member (dev `123456`; production mints a random,
never-disclosed password) — production must still wire invite/reset.

**PART 2 — the super-admin screen (`apps/web/.../[locale]/platform`).** The owner
guard pattern from #13 is extended one notch: the page's server component
redirects to `/dashboard` unless `isPlatformOwner` (the boundary; the dashboard's
owner-only nav link is just UX), and **only after** that check passes does it
build the service-role client to list **all** organizations — because, by the
approach-(b) choice above, the publishable client cannot read cross-org. The
create-organization server action re-verifies ownership server-side before
building the privileged client (never trusting the page guard), then delegates to
`createOrganizationWithFirstAdmin`. The service-role key is confined to the
`server-only` admin module and verified absent from the client bundle. Verified
end-to-end against the running app (10/10 HTTP checks: unauthenticated→login,
org-admin/member→dashboard, owner→200 with all orgs, RTL `/he`) plus the
data-layer harness (15/15).

---

## 18. Internal Org Chat — DB-Enforced Isolation + Anti-Forgery (data layer)

**Decision:** Model internal chat as an org-scoped `messages` table
(`organization_id`, `sender_id → users`, `content`, `created_at`) governed
entirely by RLS: **SELECT** is gated on `auth_user_is_member_of(organization_id)`
(our recursion-safe SECURITY DEFINER helper), and **INSERT** (`WITH CHECK`)
requires both org membership **and** `sender_id = auth.uid()`. No UPDATE/DELETE
policies (messages are immutable for now). This is PART 1 (data + RLS); realtime
delivery and UI follow in PART 2.

**Reasoning:** Chat is just another org-scoped resource, so it reuses the exact
tenant-isolation pattern (decision #11) rather than inventing anything — org A
can never read org B's messages, enforced by the database. The one chat-specific
addition is the `sender_id = auth.uid()` check: identity in a chat is
load-bearing, so "you can only post as yourself" must be a hard DB guarantee, not
an app convention — otherwise a crafted request could attribute a message to
another user even within the same org. Keeping messages immutable for now avoids
designing edit/delete semantics (and their policies) before they're needed.
Verified live (6/6): post+read within your org; cross-org read and insert both
denied; forged `sender_id` rejected with no row landing. The security advisor
reports no new findings. See `packages/db/SCHEMA.md`.

**PART 2 — realtime delivery (`messages` in the `supabase_realtime`
publication).** Live updates use Supabase **Postgres Changes** (subscribe to
`messages` INSERTs filtered by `organization_id`), chosen because **Postgres
Changes already enforces RLS**: Realtime only delivers a row to a subscriber who
may `SELECT` it, so our existing members-only policy *is* the channel
authorization — a client that tampers with the subscription `filter` to another
org still receives nothing (the filter is a pre-filter; RLS is the boundary).
The newer `realtime.messages` authorization is only for Broadcast/Presence, so
nothing extra is needed. This was the security-critical question, so it was
verified directly over the websocket (5/5): two same-org users receive each
other's messages live, while an Org B client subscribed (with a filter tampered
to Org A) receives **zero** Org A messages. The chat page server-renders recent
history and the client sends through the **authenticated** client (so the
`sender_id = auth.uid()` policy stays the enforcer); the secret key is never
involved. UI/realtime lives in `apps/web/.../dashboard/chat`.

---

## 19. Soft Deletes via `deleted_at`, Hidden Through the RLS Helpers

**Decision:** Give `organizations`, `memberships`, and `messages` a nullable
`deleted_at timestamptz` (NULL = active) and treat "delete" as **soft** for them.
Soft-deleted rows are hidden by (a) adding `deleted_at IS NULL` to each SELECT
policy and (b) making the recursion-safe membership helpers **deleted_at-aware**
(a membership counts only if it *and* its org are active), so soft-deleting a
parent hides its children automatically. Soft-delete *writes* set `deleted_at`
server-side as `service_role`. `ON DELETE CASCADE` is kept for genuine hard
purges. `roles`, the join tables, and `permissions` stay hard-delete.

**Reasoning:** Once real data exists, physical `ON DELETE CASCADE` throws away
exactly the history that tenant offboarding, audit, and accidental-deletion
recovery need. `deleted_at` keeps the rows. Hiding via the *helpers* (not by
propagating `deleted_at` to every child) reuses the machinery that already gates
org-scoped visibility, so it stays consistent with the existing model and a
single org soft-delete cleanly removes the whole tenant from view. Crucially,
these are **read-narrowing** changes only — they add filtering, never widen
access — so tenant isolation is provably unchanged (re-verified: the soft-delete
harness plus every prior isolation harness pass). Writing soft-deletes as
`service_role` avoids the documented RLS trap where an `UPDATE ... RETURNING` that
sets `deleted_at` makes the returned row fail the SELECT policy.

**`users` deferred — explicit decision.** We do **not** add `users.deleted_at`
now. Removing a person from an organization is modeled as soft-deleting their
**membership**, not the global user identity. A `users.deleted_at` would (a) break
message attribution — hiding the profile makes a former member's past messages
render without a name — and (b) not actually disable their `auth.users` login,
which is the part that matters for "deactivation." A real account-deactivation
feature (coordinating `public.users` *and* `auth.users`, e.g. ban/delete the auth
user) will revisit this deliberately; until then, membership soft-delete covers
the common offboarding case. See `packages/db/SCHEMA.md`.

---

## 20. Vendor-Agnostic Observability (Logging + Error Reporting)

**Decision:** All logging and error reporting goes through a small in-house
abstraction, `@platform/observability` — never a vendor SDK directly. It exposes
`logger.{debug,info,warn,error}` (structured JSON console lines) and
`captureException(err, context?)`. The error-reporting backend is **pluggable**
via `setErrorReporter`: the web app registers a **Sentry** adapter from its
instrumentation **only when `SENTRY_DSN` (server) / `NEXT_PUBLIC_SENTRY_DSN`
(client) is set**; with no DSN, the default is structured console logging and
nothing else. The package is vendor- *and* framework-agnostic (zero vendor deps);
the Sentry SDK is only ever touched in two adapter files in `apps/web`.

**Reasoning:** This mirrors how `@platform/db` abstracts Supabase — a project
spawned from this template can swap monitoring vendors by editing one adapter, or
disable it by leaving the DSN empty, without touching app code. Following current
`@sentry/nextjs` practice (`instrumentation.ts` `register()` + `onRequestError`,
`instrumentation-client.ts`), the Sentry adapter is **dynamically imported and
DSN-gated**, so it never initializes (and isn't loaded) when unused.

**Security — redaction is a single chokepoint.** Every context object and error
message/stack passes through `redact()` before any sink (console *or* reporter),
scrubbing sensitive **keys** (password, token, secret, authorization, cookie,
dsn, service_role, jwt, session, email, …) and sensitive **values** (Supabase
`sb_secret_…`/`sb_publishable_…` keys, JWTs, `Bearer …`, email local-parts).
Server actions log **identifiers** (`userId`, `orgId`, `organizationId`) — never
emails, names, passwords, tokens, or the secret key. `onRequestError` logs only
request method/route, never headers (which carry auth cookies). Verified (21/21):
secrets of every shape are scrubbed while identifiers survive; the real secret key
is absent from the client bundle. No DSN is ever hardcoded — all via env
(`.env.example`).

---

## 21. User-Facing Error States — Calm, Localized, Never Technical

**Decision:** Users never see a raw stack trace, error message, or white screen.
Every failure surfaces a **calm, translated, themed** state, while the technical
detail goes only to the logger (decision #20). Concretely: a route error boundary
(`[locale]/error.tsx`) with a retry action; a localized 404
(`[locale]/not-found.tsx`) reached for any unknown in-locale path via a catch-all
(`[locale]/[...rest]`) that funnels Next's otherwise-default 404 through our page;
a last-resort `global-error.tsx`; and form/action flows that render only
**translated** error keys (never `error.message`) plus pending/disabled loading
feedback. The one place that echoed a raw DB error to the user (the home health
check) now logs it and shows a translated message.

**Reasoning:** Raw errors are both a poor experience and a security risk — stack
traces and DB messages can leak internals. Routing all error UI through i18n keys
guarantees nothing technical reaches the screen, and pairing it with the
observability layer means the detail is still captured for operators. The 404
catch-all is required because Next renders its *non-localized* default 404 for
unmatched routes; funneling them through `notFound()` keeps every error state
on-brand, in the user's language and theme (he/en, RTL/LTR). Verified: the 404
renders translated in both locales with `dir="rtl"` for Hebrew, and the boundaries
render only `t()` strings (the error `digest` is logged, never displayed).

---

## 22. CI Gate — Static Checks on Every Push and PR

**Decision:** A GitHub Actions workflow (`.github/workflows/ci.yml`) runs
`pnpm install` → `pnpm lint` → `pnpm typecheck` → `pnpm build` (turbo, whole
monorepo) on every push to `main` and every PR targeting `main`, with each as a
separate failing step. It runs **only static checks** — no secrets, no live
Supabase. Node 20 (engines `>=20.9`), pnpm from `packageManager`, pnpm store
cached.

**Reasoning:** This is the automated gate that catches regressions before merge —
exactly the class that slipped through before every package had its own
`typecheck` task. Keeping it to lint/typecheck/build means it needs no secrets and
stays fast and deterministic; DB-dependent tests/e2e belong in a later, separate
job wired to CI secrets once those tests exist. `pnpm-lock.yaml` is **committed**
and CI installs with `--frozen-lockfile`, so the gate is reproducible — the
install fails if a manifest and the lockfile disagree, making "works in CI" the
same as "works for a teammate cloning the repo".

---

## 23. Landing Page — Temporary Explainer, Internals-Safe, Demo Fenced

**Decision:** The home page (`/[locale]`) is a designed **landing/explainer** for
semi-technical partners (hero, what-this-is, architecture, security, why-it-
matters, demo access), token-driven so both themes + RTL/LTR work, fully i18n
(he/en), with a distinctive bilingual serif display face. It is **temporary
content** — real product marketing will replace it. Two rules govern it: (1) the
copy describes the *approach*, never exploitable internals (no table/helper names,
no project refs — verified absent from the rendered HTML of both locales); (2) the
**demo-access** block (the seeded logins + shared password) is **safe by default**
— it renders in development but, in a production build, ONLY when
`NEXT_PUBLIC_SHOW_DEMO_ACCESS=1` is explicitly set (for a dedicated evaluation
deploy with no real data). It's isolated in one component
(`src/components/demo-access.tsx`) for trivial removal, with a defense-in-depth
early-return so it can never render when disabled.

**Reasoning:** Partners need to understand and *try* the platform, which means
showing demo credentials — but those, and any internal detail that aids an
attacker, must never reach a real production site. Fencing the demo into one
component makes removal a one-step pre-production gate; keeping the explainer copy
to high-level posture (DB-level tenant isolation, server-side permission re-checks,
secrets in env only, redacted logging) communicates credibility without leaking
how to attack it. The raw permission-catalog dump from the dev health check is
replaced by a reachability-only "systems operational" pill (HEAD/count, no data).

**Pre-production gate:** the env flag makes the demo safe-by-default, but before a
real launch, also remove the demo-access component and revisit the page as real
marketing — alongside the other deferred pre-production items (HIBP, onboarding
flow). See `README.md`.

---

## 24. Bound User Input at the DB Layer (CHECK Constraints)

**Decision:** Cap the length and forbid empty/whitespace-only values for all
user-supplied text (`messages.content` ≤ 4000; `organizations.name`, `roles.name`,
`users.display_name` ≤ 200) with Postgres **CHECK constraints** (migration
`20260610000002`), rather than relying on UI `maxLength` or server-action
validation.

**Reasoning:** The boundary must hold for *every* caller, not just the browser.
The chat composer posts **directly** to PostgREST via the authenticated client —
there is no server action in that path — so a client that ignores the UI can send
arbitrarily large or empty bodies; RLS permits the write (valid member, correct
`sender_id`), so only a DB constraint can stop it. The same principle applies to
the names written by the privileged (service-role) create paths. Enforcing in the
database makes the rule independent of which code path (or key) performs the write.
The raw length is capped (not the trimmed length) because a trimmed-only cap still
allows whitespace-padding storage abuse; "non-empty" uses `~ '[^[:space:]]'` rather
than single-arg `btrim` (which strips only spaces, missing tab/newline-only input).
This closes security-review findings **M1** (unbounded input) and **L2** (empty
messages). Verified service-side, 14/14, with all prior isolation harnesses green.

---

## 25. Mobile App — Expo + Expo Router, Sharing the Same Packages

**Decision:** `apps/mobile` is an Expo (SDK 54) + Expo Router + TypeScript app in
the same monorepo, consuming the existing `@platform/*` packages rather than
duplicating them. SDK 54 (not the newer npm-`latest` 56) is pinned deliberately:
modern Expo Go runs a single SDK, and the public store build currently supports
SDK 54 (`expoGoSdkVersion` from Expo's versions API) — so 54 is the newest SDK
that runs in stock Expo Go without a custom dev build. Bump it when Expo Go does. Metro is given the canonical monorepo config (`watchFolders` =
repo root, `nodeModulesPaths` = app then root). Client env uses Expo's
`EXPO_PUBLIC_` prefix; the secret key is never shipped to the client (same rule
as web). A new framework-agnostic `createNativeDbClient` was added to
`@platform/db` (plain `supabase-js`, no `@supabase/ssr` — its `document`/cookie
storage doesn't exist in React Native). It now accepts an optional `storage`
adapter: when one is passed (mobile passes **AsyncStorage**), session
persistence and `autoRefreshToken` turn on automatically; with no adapter it
stays stateless (the health-check path). This is what lets mobile "stay logged
in across app restarts" — on launch `getSession()` rehydrates from AsyncStorage.
Mobile login (STEP 2) reuses the same `@platform/auth` `signIn`/`signOut`/
`getUserOrganizations` as web; only the client transport differs (AsyncStorage
on mobile vs. `@supabase/ssr` cookies on web). Token auto-refresh is gated on
`AppState` foreground, per Supabase's RN guidance.

**Transitive-version pinning (pnpm).** Downgrading the SDK left a stale
`@expo/metro-runtime@56` in the tree (pnpm `auto-install-peers` had grabbed the
newest to satisfy expo-router's peer). SDK-54 `expo-router` imports
`@expo/metro-runtime/error-overlay` — a subpath only the SDK-54 build (`6.1.2`)
exposes — so the **dev** bundle failed to resolve it (production export silently
passed because error-overlay is dev-only, `NODE_ENV !== 'production'`). A root
`pnpm.overrides` alone did NOT fix it (overrides don't reliably constrain
auto-installed peers), so `@expo/metro-runtime` is now both an explicit
`apps/mobile` dependency (`~6.1.2`) and pinned to `6.1.2` via `pnpm.overrides`.
Lesson: verify the **dev** bundle (the Metro dev-server path Expo Go actually
loads), not just `expo export`.

**Reasoning:** The shared packages are deliberately framework-agnostic and
React-free (decision #12/#13), so mobile reuses identity, data, and i18n logic
unchanged — the payoff of the monorepo philosophy. Because no shared package
pulls React, the classic Expo-monorepo "duplicate React" hazard doesn't apply
here (only the app depends on `react`/`react-native`). STEP 1 is intentionally a
single Supabase health-check screen proving the app runs, resolves the shared
packages through Metro, and reaches Supabase — verified with both a production
`expo export` and the Expo Go dev bundle. Screens/navigation/auth come in later,
deliberate steps.

---

## 26. Authenticated Admin API Endpoints for Mobile (Bearer Token, Re-check-then-Admin-Client)

**Decision:** Privileged operations that the mobile app needs but that require the
secret key — **add a user to an org** and **create an org + first admin** — are
exposed as **authenticated POST route handlers in `apps/web`**
(`/api/admin/members`, `/api/admin/organizations`), not as new mobile-side code.
Mobile has no server and must never hold the secret key, so it sends its Supabase
**access token** as `Authorization: Bearer <token>`; the handler validates the
token server-side (`auth.getUser(token)`), builds a **user-scoped (RLS) client**
from it (`@platform/db` `createTokenDbClient`), and runs the **same
authorize-then-act** flow as the web server actions. That flow now lives in one
shared place — `apps/web/src/lib/admin/{add-member,create-organization}.ts` —
called by **both** the existing server actions and the new route handlers (zero
duplication of the privileged path). The authorization re-check runs on the
RLS-scoped client **first** (`members.manage` in the target org for add-member;
`isPlatformOwner` for create-org), and only then is the `server-only` admin
client constructed — unchanged from #16/#17.

**Reasoning:** API routes in `apps/web` (rather than Supabase Edge Functions) let
us **reuse `@platform/auth` and the `server-only` admin module verbatim**, keep a
**single deploy and secrets surface** (one place holds `SUPABASE_SECRET_KEY`), and
run the monorepo packages **natively** (no separate Deno bundle / duplicated
logic). The Bearer-token model mirrors the web's cookie model: both produce an
RLS-scoped client on which the *same* permission check is the real boundary, so
tenant isolation is preserved — an Org A admin's token yields `members.manage =
false` for Org B and is rejected (403). Token validation failures are **401**,
permission/owner failures **403** (distinct), bad input **400**, and every
response is a **translated i18n key** (`{ error: '<key>' }`), never a raw message;
logs carry **identifiers only** (userId/orgId) through `@platform/observability`'s
redaction. The new-user/first-admin passwords keep the #16 `NODE_ENV` gate (dev
`123456`; production random + never disclosed). The `/api` path is excluded from
the next-intl proxy matcher, so the handlers aren't locale-rewritten.

**Verified** (14/14, scripted against the running dev server, `scripts/verify-admin-api.mjs`):
no/garbage token → 401; member without `members.manage` → 403 (no user created);
Org A admin → Org B → 403 (tenant isolation, no user created); Org A admin → Org A
→ 200 with membership+role provisioned; duplicate email → 409 with rollback intact
(no half-provisioned user); non-owner create-org → 403; owner create-org → 200 with
a functional first admin (can sign in); over-length names → 400 (and the DB CHECK
independently rejects with `23514`); non-POST → 405. The secret key remains absent
from the client bundle (`.next/static`), while the publishable key is present
(grep sanity). Existing web server-action flows are unchanged — they now call the
same shared functions, exercised at runtime by the API tests, and the
members/platform pages still render (307 to login when unauthenticated).

**Mobile wiring (Part B) + the orgs-list GET.** The platform-owner screen needs
the all-orgs list, which RLS approach (b) keeps off the publishable client — so a
**GET** was added to `/api/admin/organizations` following the exact pattern:
Bearer → owner re-check on the token-scoped client (shared `listOrganizations`)
→ service client → return id/name/memberCount/createdAt (active only, soft
deletes excluded). Other methods still 405. Verified 3/3 (`--get-only`): no token
→ 401, non-owner → 403, owner → 200 with the seeded orgs.

The mobile client (`apps/mobile/lib/admin-api.ts`) reads its base URL from
`EXPO_PUBLIC_API_URL` (client env only — never the secret key) and sends the
session's access token as the Bearer. Its **error contract**: 401 → the session
is dead, so it signs out locally and routes to login; 403/400/409 → the returned
i18n key, translated in the **endpoint's namespace** (`members` for
`/api/admin/members`, `platform` for `/api/admin/organizations`); a network
failure → a generic `common.connectivity` message. Raw error text is never shown.
The mobile add-user (members screen) and create-org (platform screen) call these
endpoints; permission-aware UI hides the entry points (the server stays the
boundary), and the dev temp-password hint is gated by `__DEV__` to mirror the
server's `NODE_ENV` gate.

## Future Considerations

- **When to split:** If a business domain grows large enough (100+ engineers), consider a multi-monorepo strategy where that domain gets its own repo.
- **Performance optimization:** As the monorepo grows, Turborepo's remote caching can be leveraged for CI/CD speedup.
- **API versioning:** Core business logic should be versioned when breaking changes occur to avoid cascading updates.
