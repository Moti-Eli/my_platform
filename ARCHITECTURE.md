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

---

## Future Considerations

- **When to split:** If a business domain grows large enough (100+ engineers), consider a multi-monorepo strategy where that domain gets its own repo.
- **Performance optimization:** As the monorepo grows, Turborepo's remote caching can be leveraged for CI/CD speedup.
- **API versioning:** Core business logic should be versioned when breaking changes occur to avoid cascading updates.
