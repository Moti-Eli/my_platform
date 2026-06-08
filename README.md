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

**Phase 2: Web App Skeleton** 🚧 (in progress)
- ✅ `apps/web` scaffolded: Next.js 16 (App Router, Turbopack), TypeScript
  strict, wired to the shared `@platform/*` packages
- ✅ i18n via next-intl: locale-prefixed routing (`/he`, `/en`, `he` default),
  dynamic `dir` (RTL/LTR), translations sourced from `@platform/i18n`
- ✅ Token-driven theming (Tailwind v4 + CSS variables from `@platform/config`),
  two themes switchable at runtime, persisted via cookie (SSR-safe)
- ✅ Supabase wiring (`@supabase/ssr`) with a working home-page health check

**Coming Next:**
- Authentication & permission checks (`@platform/auth`)
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
Authentication and authorization:
- Role-based access control (RBAC)
- Permission system
- Supabase authentication wrapper
- Session management

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
# 1. Provide Supabase env (publishable key is safe for the client):
#    apps/web/.env.local
#      NEXT_PUBLIC_SUPABASE_URL=...
#      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
# 2. From the repo root:
pnpm dev            # starts the web dev server (http://localhost:3000 -> /he)
```

The home page shows the app name, a language switcher, a theme toggle, and a
Supabase health check that lists the seeded permission keys.

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
4. 🔐 Implement authentication & permission checks (`@platform/auth`)
5. 📱 Scaffold Expo mobile app
6. 🌍 Add first feature domain

## 📝 License

Private project. All rights reserved.
