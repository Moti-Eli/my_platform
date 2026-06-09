# my-platform

Multi-domain business management platform built with Turborepo + pnpm.

A production-ready monorepo skeleton designed to scale across multiple business domains with shared infrastructure, authentication, and design systems.

## 📋 Current Status

**Phase 0: Infrastructure Setup** ✅
- Monorepo structure with Turborepo + pnpm workspaces
- Shared configuration and design tokens
- TypeScript strict mode everywhere
- Placeholder apps (Next.js web, Expo mobile)
- Conventional Commits readiness

**Phase 1: Database — Multi-Tenant RBAC** ✅
- ✅ Step 1: Core RBAC schema migration (organizations, users, memberships,
  roles, permissions, and join tables) with DB-level same-organization
  integrity on role assignments — **applied to the Supabase cloud project**
  (migration `20260605000001`) — see `packages/db/SCHEMA.md`
- ✅ Step 2: Row Level Security enabled on all 7 tables with org-membership
  tenant-isolation policies (read-only for now) — **applied to the Supabase
  cloud project** (migration `20260605000002`)
- ✅ Step 2b: Global `permissions` catalog made publicly readable for the
  web health check (migration `20260608000001`)

**Phase 2: Web App Skeleton** ✅
- ✅ `apps/web` scaffolded: Next.js 16 (App Router, Turbopack), TypeScript
  strict, wired to the shared `@platform/*` packages
- ✅ i18n via next-intl: locale-prefixed routing (`/he`, `/en`, `he` default),
  dynamic `dir` (RTL/LTR), translations sourced from `@platform/i18n`
- ✅ Token-driven theming (Tailwind v4 + CSS variables from `@platform/config`),
  two themes switchable at runtime, persisted via cookie (SSR-safe)
- ✅ Supabase wiring (`@supabase/ssr`) with a working home-page health check

**Phase 3: Authentication & RBAC** ✅
- ✅ `@platform/auth`: email/password sign-in, sign-out, current user, and RBAC
  resolution (org membership → roles → effective permissions; admin ⇒ all)
- ✅ Login page (`/[locale]/login`) with translated error handling (he/en)
- ✅ Protected dashboard (`/[locale]/dashboard`) showing the user's org(s) and
  role(s); logged-out access redirects to login; logout clears the session
- ✅ Session refresh in the proxy (`@supabase/ssr`) composed with next-intl

**Phase 4: Admin Member Management** ✅
- ✅ DB-enforced write path: `members.manage` permission gates `membership_roles`
  writes via RLS (migration `20260608000003`)
- ✅ Member-management screen (`/[locale]/dashboard/members`): polished,
  token-driven members table; change a member's role (Admin ↔ Member)
- ✅ Permission-aware UI: editing controls show only if the user has
  `members.manage` (via `@platform/auth` `hasPermission`); otherwise read-only.
  Writes go through the authenticated client so RLS is the real enforcer
- ✅ "Can't remove the last admin" guard (UI-level; DB-level guard is a TODO)
- ✅ **Add user to organization**: an admin (anyone with `members.manage`) can
  create a new user — email + display name + initial role — via an accessible,
  i18n/RTL modal. Runs in a **server action** with the secret key (the one path
  that needs `service_role`, to create the `auth.users` row), behind a
  mandatory server-side permission re-check; the secret key is confined to a
  `server-only` module and never reaches the client. No cross-org creation;
  duplicate emails surface a translated error. See ARCHITECTURE.md #16.

**Phase 5: Platform Owner (Super Admin)** ✅
- ✅ PART 1 — data layer: `platform_admins` allowlist table (PK → `auth.users`),
  an access level **above** org admins (migration `20260609000001`, applied to
  cloud). **Sealed & not self-assignable**: RLS + no policies + `REVOKE ALL` from
  anon/authenticated → only the server-side `service_role` can grant ownership.
  `auth_user_is_platform_owner()` `SECURITY DEFINER` RPC (caller-only boolean).
  Server-side `createOrganizationWithFirstAdmin` in `@platform/auth` (owner
  re-checked server-side; atomic-ish with rollback). **No new cross-org RLS** —
  super-admin power is server-side only, so tenant isolation is unchanged.
- ✅ PART 2 — super-admin UI (`/[locale]/platform`): a **platform-owner-only**
  screen that lists **all** organizations (name, member count, created date) and
  creates a new org + first admin (accessible modal, i18n he/en, RTL/LTR, both
  themes). The route is **guarded server-side** on `isPlatformOwner` (non-owners
  are redirected to `/dashboard`); the all-orgs listing is fetched with the
  **service-role client only after** that guard passes (the publishable client
  can't read across orgs by design). The create server action re-checks ownership
  server-side before acting. The dashboard shows a "Platform admin" nav link only
  to owners. See ARCHITECTURE.md #17.

**Phase 6: Internal Org Chat (Realtime)** ✅
- ✅ PART 1 — data layer: `messages` table (org-scoped; `sender_id` →
  `auth.users`) with RLS (migration `20260609000002`, applied to cloud). **SELECT**
  is members-only (`auth_user_is_member_of`); **INSERT** requires org membership
  **and** `sender_id = auth.uid()` (anti-forgery — you can only post as
  yourself); messages are immutable (no update/delete). Verified live (6/6):
  cross-org read/insert denied, forged sender rejected.
- ✅ PART 2 — realtime chat UI (`/[locale]/dashboard/chat`): server-rendered
  recent history + a **Supabase Realtime** (Postgres Changes) subscription so new
  messages appear live. Sends go through the authenticated client (RLS enforces
  the sender). Token-driven bubbles distinguish your own messages, i18n (he/en),
  RTL/LTR, both themes. Realtime is added to the `supabase_realtime` publication
  (migration `20260609000003`). **Socket tenant isolation is RLS-enforced and
  verified (5/5)**: same-org users get each other's messages live; a cross-org
  client (even tampering its filter) receives nothing. See ARCHITECTURE.md #18.

**Phase 7: Pre-production Hardening** 🚧 (in progress)
- ✅ Stripped `TRUNCATE/TRIGGER/REFERENCES` from `anon`/`authenticated` on all
  tables + future-table defaults (migration `20260609000004`)
- ✅ DB-level **last-admin guard**: a deferred constraint trigger rejects removing
  an org's last admin even via a direct privileged call (migration `20260609000005`)
- ✅ Covering indexes for the `membership_roles` and `messages` foreign keys —
  performance advisor's unindexed-FK findings cleared (migrations `…06`, `…07`)
- ✅ **Soft deletes** (`deleted_at`) for `organizations`, `memberships`,
  `messages`: soft-deleted rows are hidden from normal reads via the RLS helpers
  (tenant isolation unchanged), rows retained for history/recovery; `users`
  deliberately deferred (migration `20260610000001`). See ARCHITECTURE.md #19.
- ✅ **Observability** (`@platform/observability`): vendor-agnostic structured
  logging + error reporting, with an optional env-activated **Sentry** adapter and
  built-in secret/PII redaction. App code never imports a vendor SDK directly. See
  the Observability section below + ARCHITECTURE.md #20.
- ⏳ Deferred to pre-production: enable leaked-password protection (HIBP, needs a
  Pro plan) + switch to a strong dev password — tracked as one combined step.

**Coming Next:**
- Expo mobile app scaffolding
- Feature development

## 🏗️ Project Structure

```
my-platform/
├── apps/
│   ├── web/          (Next.js 16 app: i18n, RTL, theming, Supabase)
│   └── mobile/       (Expo mobile app - placeholder)
├── packages/
│   ├── config/       (ESLint, TS configs, design tokens, Prettier)
│   ├── core/         (Business logic, types, API client)
│   ├── auth/         (RBAC, permissions, Supabase wrapper)
│   ├── i18n/         (Translations: English, Hebrew)
│   ├── ui/           (Shared UI components)
│   └── db/           (Supabase client, schema, migrations)
├── turbo.json        (Turborepo pipeline configuration)
├── pnpm-workspace.yaml
├── package.json
└── docs/             (Documentation)
```

## 🚀 Quick Start

### Prerequisites
- Node.js >= 18.17.0
- pnpm >= 9.0.0

### Installation

```bash
# Install dependencies
pnpm install

# Start development servers (all packages in parallel)
pnpm dev

# Run linting across all packages
pnpm lint

# Run TypeScript type checking
pnpm typecheck

# Build all packages
pnpm build
```

### Project Commands

| Command | Description |
|---------|-------------|
| `pnpm install` | Install all dependencies |
| `pnpm dev` | Start all dev servers in parallel |
| `pnpm build` | Build all packages |
| `pnpm lint` | Run ESLint across all packages |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm format` | Format code with Prettier |
| `pnpm seed` | Seed dev test data (2 orgs + users) — see `packages/db` |
| `pnpm clean` | Remove node_modules and lock file |

## 📦 Package Guide

### `@platform/config`
Shared configuration for the entire platform:
- Design tokens (colors, spacing, radii, fonts)
- TypeScript configurations (strict mode enabled)
- ESLint rules
- Prettier formatting

### `@platform/core`
Core business logic and types:
- Shared TypeScript interfaces
- Business entities
- API client utilities
- Data transformations

### `@platform/auth`
Authentication and authorization (UI-agnostic; takes a Supabase client):
- `signIn` / `signOut` / `getCurrentUser`
- RBAC resolution: `getUserOrganizations`, `getEffectivePermissions`,
  `hasPermission` (admin role ⇒ all permissions)
- Runs as the current user, so RLS enforces tenant isolation

### `@platform/i18n`
Internationalization and translations:
- English (en)
- Hebrew (he)
- Built-in language support structure

### `@platform/ui`
Shared UI component library:
- Platform-agnostic components
- Accessible by default
- Design token integration

### `@platform/db`
Database layer:
- Supabase client wrapper
- Schema definitions — see [`packages/db/SCHEMA.md`](./packages/db/SCHEMA.md)
- Migration management — multi-tenant RBAC core schema (Step 1) lives in
  `packages/db/supabase/migrations/`

### `@platform/web`
Next.js 16 web application (App Router, Turbopack, TypeScript strict):
- Locale-prefixed i18n via next-intl (`/he`, `/en`; `he` default; RTL/LTR)
- Token-driven theming (Tailwind v4 + CSS variables), runtime theme switch
- Supabase wiring via `@supabase/ssr` (browser + server clients)
- Consumes `@platform/config`, `@platform/i18n`, `@platform/db`, `@platform/ui`

**Running it:**

```bash
# 1. Provide Supabase env in apps/web/.env.local:
#      NEXT_PUBLIC_SUPABASE_URL=...
#      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...   # safe for the client
#      SUPABASE_SECRET_KEY=...                    # server-only; needed for the
#                                                 # admin "Add user" action.
#                                                 # No NEXT_PUBLIC_ prefix, so it
#                                                 # is never shipped to the browser.
# 2. From the repo root:
pnpm dev            # starts the web dev server (http://localhost:3000 -> /he)
```

The home page shows the app name, a language switcher, a theme toggle, and a
Supabase health check that lists the seeded permission keys.

### `@platform/observability`
Vendor- and framework-agnostic **logging + error reporting**:
- `logger.{debug,info,warn,error}` → structured JSON console lines
- `captureException(err, context?)` → logs + forwards to the active reporter
- Pluggable backend via `setErrorReporter` (optional **Sentry** adapter, env-gated)
- Built-in **secret/PII redaction** before any sink — app code imports only this,
  never a vendor SDK directly

### `@platform/mobile`
Mobile application placeholder (Expo coming soon):
- React Native components
- Native module bridges
- Platform-specific code

## 🔧 Configuration Files

### `.env.example`
Template for environment variables. Copy to `.env` and fill in your values:
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` - Supabase publishable key
  (`sb_publishable_...`; formerly the "anon" key) — safe for client use
- `SUPABASE_SECRET_KEY` - Supabase secret key (`sb_secret_...`; formerly the
  "service_role" key) — server-side only, never exposed to the client
- Additional API and feature flag configuration

**Note:** `.env` is gitignored and never committed.

### `turbo.json`
Defines build pipeline:
- `build` - Builds all packages
- `lint` - Lints all packages
- `typecheck` - Type-checks all packages
- `dev` - Runs dev servers

### `pnpm-workspace.yaml`
Workspace configuration for all packages and apps.

## 🔐 Secrets & Environment

All secrets go in `.env` (gitignored):
- Never commit `.env`
- Use `.env.example` as a template
- Deploy secrets via CI/CD platform (GitHub Actions, etc.)

## 🔭 Observability (logging + error reporting)

App code logs and reports errors **only** through `@platform/observability` —
never a vendor SDK directly — so the backend is swappable from one adapter.

- **Default (no config):** errors and logs go to the console as **structured JSON
  lines** (`level`, `timestamp`, `msg`, `context`, `error`). Nothing else happens.
- **Enable Sentry (optional):** set `SENTRY_DSN` (server) and
  `NEXT_PUBLIC_SENTRY_DSN` (browser) in `.env.local`. The Sentry adapter then
  initializes and errors are reported there **in addition to** the console log.
  Leave them empty to disable. Never commit a real DSN.
- **Secrets never hit logs:** every log context + error is run through a redaction
  layer that scrubs passwords, tokens, the Supabase keys, `Bearer …`, JWTs, and
  emails. Prefer logging identifiers (`userId`, `orgId`) over sensitive content.
- **Swap vendors:** replace the two adapter files
  (`apps/web/src/lib/observability/sentry.{server,client}.ts`) with your provider
  and register it via `setErrorReporter` — no app code changes.

See `ARCHITECTURE.md` #20 and `packages/observability/README.md`.

## 🎯 Development Workflow

### Conventional Commits

This project uses Conventional Commits with commitlint and husky:

```bash
# Examples of valid commits:
git commit -m "feat: add user authentication"
git commit -m "fix: resolve login redirect issue"
git commit -m "refactor: optimize database queries"
git commit -m "docs: update README"
```

Pre-commit hooks run:
- ESLint (linting)
- TypeScript (type checking)

### Making Changes

1. Create a feature branch: `git checkout -b feature/my-feature`
2. Make changes across packages as needed
3. Test locally: `pnpm dev`, `pnpm lint`, `pnpm typecheck`
4. Commit with conventional commit message
5. Push and open a PR

### Working with Turborepo

Turborepo caches build outputs and intelligently runs only affected packages:

```bash
# Run tasks only on changed packages
pnpm dev

# Force rebuild all
pnpm build --force

# View task graph
pnpm build --graph
```

## 📚 Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Key architectural decisions and reasoning
- [CLAUDE.md](./CLAUDE.md) - Instructions for AI sessions

## 🛠️ Tech Stack

- **Monorepo**: Turborepo + pnpm
- **Language**: TypeScript (strict mode)
- **Web**: Next.js 16 (App Router, Turbopack) + React 19
- **i18n**: next-intl (locale-prefixed routing, RTL/LTR)
- **Styling**: Tailwind CSS v4 (design tokens via CSS variables)
- **Database/Auth**: Supabase (`@supabase/ssr`)
- **Linting**: ESLint
- **Formatting**: Prettier
- **Git Hooks**: Husky
- **Commit Linting**: Commitlint
- **Package Manager**: pnpm
- **Node**: 20.9.0+

## 📖 Next Steps

1. ✅ Monorepo infrastructure
2. ✅ Set up Supabase database (multi-tenant RBAC schema + RLS, applied to cloud)
3. ✅ Scaffold Next.js web app (i18n, RTL, theming, Supabase wiring)
4. ✅ Authentication & RBAC (`@platform/auth`): login, protected dashboard
5. 📱 Scaffold Expo mobile app
6. 🌍 Add first feature domain

## 🔐 Authentication

- **Login**: `/[locale]/login` (email + password). On success → dashboard.
- **Protected route**: `/[locale]/dashboard` — server-side guard redirects to
  login if there's no session. Session refresh runs in the proxy.
- **Logout** clears the session and returns to login.
- Seed dev test users with `pnpm seed` (see `packages/db`), e.g.
  `admin1@organizationA.com` / `123456`. The seed also creates a **platform
  owner** (super admin) `owner@platform.test` / `123456` — flagged in
  `platform_admins`, belonging to no organization.

## 📝 License

Private project. All rights reserved.
