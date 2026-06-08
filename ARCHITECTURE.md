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

## Future Considerations

- **When to split:** If a business domain grows large enough (100+ engineers), consider a multi-monorepo strategy where that domain gets its own repo.
- **Performance optimization:** As the monorepo grows, Turborepo's remote caching can be leveraged for CI/CD speedup.
- **API versioning:** Core business logic should be versioned when breaking changes occur to avoid cascading updates.
