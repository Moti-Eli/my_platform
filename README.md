# Cortex

A phone-first **super-app** for running a business: one installable PWA (RTL
Hebrew, he/en) that hosts many small tools on a shared, multi-tenant,
permission-aware core. Built with Turborepo + pnpm, Next.js, and Supabase.

> The repository is still named `my_platform` for historical reasons. The earlier
> `apps/web` + `apps/mobile` platform was removed (ARCHITECTURE.md #34). It is
> recoverable from commit `4e356f2`.

## 📋 Current Status

- **Shell:** tab bar, AI sheet and urgency bell (placeholders), catalog,
  profile (status tags from the tools, name edit, photo upload), settings
  (language, theme, version), PWA install and offline shell.
- **Auth & tenancy:** Supabase login, multi-org with org switching, RBAC
  (roles → permissions), row-level access (`visibility` + `record_grants`)
  enforced by Postgres RLS.
- **Tools** (`apps/cortex/src/tools/`): inventory, tasks (filters, week view,
  categories, urgency), notes, expenses, journal, staff, candidates (admin-only)
  + questionnaire, time entries, orders (suppliers, catalog with optional
  product prices, WhatsApp order),
  shifts (positions, employees, weekly shifts, staffing requirements, Home card
  with today's shifts).
- **Database:** 51+ migrations in `packages/db/supabase/migrations`, applied with
  the manual **DB Migrations** workflow (see below).
- **CI:** lint, typecheck and build on every push to `main` and every PR. There
  are no automated tests yet.

Detailed build order, decisions and open work: [`docs/Cortex-Roadmap.md`](./docs/Cortex-Roadmap.md).

## 🏗️ Project Structure

```
my_platform/
├── apps/
│   └── cortex/        The app: Next.js App Router PWA (shell + tools)
├── packages/
│   ├── cortex-core/   Engine: registry, runIntent data-layer, event-bus, contracts
│   ├── auth/          Authentication + RBAC helpers (Supabase)
│   ├── db/            Supabase client factories, migrations, seed/verify scripts
│   └── config/        TS configs, ESLint, Prettier, design tokens
├── docs/              Cortex standard, new-tool runbook, roadmap
└── .github/workflows/ ci.yml (checks) · db-migrations.yml (manual migrations)
```

## 🔁 How We Work

Development happens through **GitHub only**, usually in cloud Claude Code
sessions, often from a phone:

1. Each change goes on a **branch**, which becomes a **PR**.
2. CI must be green. The PR gets a **Vercel preview** URL to check on a phone.
3. **Merge to `main`** deploys to production.
4. Schema changes are applied deliberately with **DB Migrations**: dry run first,
   then apply.

Cloud Claude Code sessions run `.claude/hooks/session-start.sh` on startup. It
runs `pnpm install`, so `pnpm lint`, `pnpm typecheck`, `pnpm build` and the
smoke tests (`pnpm --filter @platform/cortex-core smoke`) work right away.

## 🚀 Running Locally (optional)

Requires Node ≥ 20.9 and pnpm 9.

```bash
pnpm install
# Put NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and
# SUPABASE_SECRET_KEY in apps/cortex/.env (see .env.example and apps/cortex/README.md)
pnpm --filter @platform/cortex dev     # http://localhost:3001
```

```bash
pnpm lint        # must pass
pnpm typecheck   # must pass
pnpm build       # should pass
pnpm seed        # seed dev test orgs/users (packages/db, uses the root .env)
```

## ⚙️ Continuous Integration

`.github/workflows/ci.yml` runs on every push to `main` and every PR targeting
`main`:

```
pnpm install --frozen-lockfile  →  pnpm lint  →  pnpm typecheck  →  pnpm build
```

No secrets and no live database are involved: these are static checks only.
`pnpm-lock.yaml` is committed, and CI installs with `--frozen-lockfile`.

### Database migrations (manual workflow)

`.github/workflows/db-migrations.yml` applies `packages/db/supabase/migrations`
to the Supabase project from GitHub, with no local machine needed. It **only runs
manually**: Actions → **DB Migrations** → Run workflow (also from the GitHub
phone app).

- `apply` unchecked (default) → **dry run**: shows applied vs. pending
  migrations and changes nothing.
- `apply` checked → `supabase db push` applies the pending migrations.

The job runs in the `production` GitHub Environment (Settings → Environments):
required reviewer = the repo owner, deployment branches = `main`, and the three
secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`
stored as **environment** secrets. Any collaborator can start a run, but it waits
for the owner's approval. It never runs on push or merge, so a schema change can't
ship by accident. See ARCHITECTURE.md #33.

**Who deploys:** collaborators open PRs and get Vercel previews. Only the repo
owner approves and merges to `main` (which is the production deploy) and
approves migration runs. This is enforced by branch protection on `main` and by
the `production` environment.

## 🔐 Secrets & Environment

- Cortex reads three variables: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` (server-only,
  never `NEXT_PUBLIC_`).
- **Production:** Vercel project → Settings → Environment Variables.
- **Migrations:** GitHub repository secrets (above).
- **Cloud Claude Code sessions:** the environment's settings, with **dev** keys
  only.
- `.env` files are gitignored and never committed.

## 📚 Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md): architectural decisions and reasoning (#27+ is Cortex)
- [docs/Cortex-SubApp-Standard.md](./docs/Cortex-SubApp-Standard.md): the tool contract
- [docs/Cortex-New-Tool-Runbook.md](./docs/Cortex-New-Tool-Runbook.md): how to add a tool
- [docs/Cortex-Roadmap.md](./docs/Cortex-Roadmap.md): status, decisions, open work
- [apps/cortex/README.md](./apps/cortex/README.md): app setup, env, phone testing
- [packages/db/README.md](./packages/db/README.md) and [SCHEMA.md](./packages/db/SCHEMA.md): migrations and schema
- [CLAUDE.md](./CLAUDE.md): instructions for AI sessions

## 🛠️ Tech Stack

Turborepo + pnpm · TypeScript (strict) · Next.js 16 (App Router) + React 19 ·
Tailwind CSS v4 · TanStack Query · zod · Supabase (Postgres + RLS + Auth) ·
Vercel · GitHub Actions · ESLint · Prettier · Husky + Commitlint

## 📝 License

Private project. All rights reserved.
