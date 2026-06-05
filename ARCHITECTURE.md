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

## Future Considerations

- **When to split:** If a business domain grows large enough (100+ engineers), consider a multi-monorepo strategy where that domain gets its own repo.
- **Performance optimization:** As the monorepo grows, Turborepo's remote caching can be leveraged for CI/CD speedup.
- **API versioning:** Core business logic should be versioned when breaking changes occur to avoid cascading updates.
