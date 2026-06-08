# @platform/web

Web application built with **Next.js 16** (App Router, Turbopack) and TypeScript
(strict mode). This is the first runnable app and the reference implementation
of the platform's three "generic" pillars: **Supabase**, **i18n (he/en + RTL)**,
and **theming**.

## Stack

- Next.js 16 (App Router, Turbopack) + React 19
- next-intl — locale-prefixed routing (`/he`, `/en`), `he` default, dynamic
  `dir` (RTL/LTR)
- Tailwind CSS v4 — utilities mapped to CSS variables emitted from
  `@platform/config` design tokens
- `@supabase/ssr` — browser + server clients (via `@platform/db`)

Consumes the shared packages `@platform/config`, `@platform/i18n`,
`@platform/db`, and `@platform/ui` (no duplicated config).

## Setup

Create `apps/web/.env.local` (gitignored):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

> The publishable key is safe for the client. The secret key is **not** used by
> the web app.

## Commands

```bash
pnpm dev         # dev server (http://localhost:3000 -> redirects to /he)
pnpm build       # production build
pnpm start       # serve the production build
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
```

Run these via the monorepo (`pnpm dev` at the root) to start everything in
parallel, or with `pnpm --filter @platform/web <task>`.

## How the pillars work

- **i18n** — `src/i18n/{routing,request,navigation}.ts` configure next-intl;
  `src/proxy.ts` handles locale detection/redirects. Messages come from
  `@platform/i18n` (the single source of truth). The `[locale]` layout sets
  `<html dir>` from the locale.
- **Theming** — `@platform/config` `themeStylesheet()` emits CSS variables for
  each theme from the design tokens. The `[locale]` layout injects them and sets
  `data-theme` from a cookie (SSR-safe, no flash). `ThemeToggle` swaps the theme
  at runtime and persists the choice.
- **Supabase** — `src/lib/supabase/{client,server}.ts` wrap the framework-
  agnostic factories in `@platform/db`. The home page runs a server-side health
  check against the `permissions` catalog to prove the wiring end to end.

## Structure

```
src/
├── proxy.ts                 # next-intl middleware (Next 16 "proxy")
├── i18n/                    # routing, request config, navigation helpers
├── lib/supabase/            # browser + server Supabase clients
├── components/              # language switcher, theme toggle (client)
└── app/
    ├── globals.css          # Tailwind v4 + token→utility mapping
    └── [locale]/            # locale-scoped root layout + home page
```
