# FEATURES.md — Feature Module Convention

How features are structured so that **adding** or **removing** one touches a
small, predictable set of places and never silently breaks the rest of the
platform. Read alongside `ARCHITECTURE.md` (especially #2 "separate UI per
platform, shared logic" and the package-boundary rules) and `CLAUDE.md`.

The guiding idea: a feature is a **vertical slice** that owns its UI, its app
logic, and its route, and connects to the platform through **one declarative
registry entry**. Features never depend on each other. This keeps the blast
radius of any add/remove confined to the feature's own folder plus one line in
the registry.

---

## 1. What counts as a "feature"

A feature is a user-facing capability that has its own destination in the app
(e.g. *Chat*, *Members*, *Calendar*, *Tasks*). It is **not** a stray component.
Every feature has:

- a stable **id** (a slug, e.g. `chat`, `members`, `calendar`),
- a **home folder** that contains everything platform-specific it owns,
- **one registry entry** that exposes it to navigation and route guards,
- optionally: shared React-free logic in a package, i18n strings, DB tables,
  a permission, and a mobile counterpart.

If two features need the same piece of code, that piece **graduates** into a
shared package — it does not get imported feature-to-feature.

---

## 2. The three layers (where code lives)

| Layer | Lives in | Reused across platforms? |
|---|---|---|
| Pure domain logic (types, validation, data calls — **React-free**) | `packages/*` (`@platform/core` or a feature package) | ✅ web + mobile |
| Platform-specific feature UI | `apps/web/src/features/<id>/` and `apps/mobile/<id>/` | ❌ rewritten per platform |
| Route shell | thin `app/[locale]/.../page.tsx` (web) / Expo Router screen (mobile) | ❌ per platform |

This is exactly ARCHITECTURE.md #2 applied at the feature granularity: share the
logic, rewrite the UI, keep the route a thin shell.

---

## 3. Anatomy of a web feature (folder shape)

```
apps/web/src/features/<id>/
├── index.ts             # the feature's public surface (what the route imports)
├── <Name>View.tsx       # main view (server or client component as needed)
├── components/          # feature-local components (not shared)
├── actions.ts           # server actions, if any
├── hooks/               # feature-local hooks
├── types.ts             # feature-local types
└── README.md            # 5 lines: what it is, its permission, its DB tables
```

The route is a **thin shell** — guard + import + render, nothing else:

```
apps/web/src/app/[locale]/dashboard/<id>/page.tsx
```

```tsx
// page.tsx — thin shell only
import { requireFeatureAccess } from '@/lib/feature-guard';
import { ChatView } from '@/features/chat';

export default async function Page() {
  await requireFeatureAccess('chat'); // redirects if not allowed (the real boundary)
  return <ChatView />;
}
```

Shared logic (if any) goes to a package, not into `features/`:

```
packages/core/src/features/<id>/...   # React-free; reused by web AND mobile
```

---

## 4. The feature registry (the single wiring point)

This is the heart of the convention. Instead of editing navigation, route
guards, and permission lists in many places, **every feature declares one
entry** in a central registry, and the platform reads from it.

**Where it lives:** the platform-agnostic metadata goes in **`@platform/core`**
(both web and mobile already render role-aware navigation, so both need "which
features exist"). Each app maps that metadata to its own routes/icons. Graduate
it to a dedicated `@platform/features` package only if it grows large.

**The shape** (`packages/core/src/features/registry.ts`):

```ts
import type { PermissionKey } from '@platform/auth';

export interface FeatureDefinition {
  /** Stable unique slug. Never reuse or rename casually. */
  id: string;
  /**
   * Route path AFTER the locale prefix — e.g. 'dashboard/chat' ->
   * /[locale]/dashboard/chat, or 'platform' -> /[locale]/platform. Not every
   * feature lives under /dashboard, so this is the full post-locale path.
   */
  route: string;
  /** i18n key for the nav label (lives in the feature's i18n namespace). */
  labelKey: string;
  /** Icon identifier; each app maps this to its own icon. */
  icon?: string;
  /** Gate. null/undefined => any authenticated org member may see it. */
  requiredPermission?: PermissionKey | null;
  /** Platform-owner-only (like the existing /platform screen). */
  ownerOnly?: boolean;
  /** Which platforms expose this feature. */
  platforms: Array<'web' | 'mobile'>;
  /** Build/runtime kill switch. false => hidden everywhere, code stays dormant. */
  enabled: boolean;
  // Future: enabledForOrg?(orgId: string): boolean   // per-tenant enablement
}

export const FEATURES: FeatureDefinition[] = [
  {
    id: 'members',
    route: 'dashboard/members',
    labelKey: 'members.navLabel',
    icon: 'users',
    // Gated today by login + org membership only — `members.manage` gates the
    // EDIT controls, not viewing. There is no view-permission: `users.view` was
    // deleted as dead, and viewing is governed by membership.
    requiredPermission: null,
    platforms: ['web', 'mobile'],
    enabled: true,
  },
  {
    id: 'chat',
    route: 'dashboard/chat',
    labelKey: 'chat.navLabel',
    icon: 'message',
    requiredPermission: null, // any member
    platforms: ['web', 'mobile'],
    enabled: true,
  },
  {
    id: 'platform',
    route: 'platform', // not under /dashboard — full post-locale path
    labelKey: 'platform.navLabel',
    icon: 'shield',
    ownerOnly: true,
    platforms: ['web', 'mobile'],
    enabled: true,
  },
];
```

> The snippet above matches the live registry in
> `packages/core/src/features/registry.ts`. `PermissionKey` is a string-union
> type exported from `@platform/auth`; the live catalog now holds exactly one key,
> `members.manage` (`users.view` and `roles.manage` were both deleted as
> dead/unenforced — migrations `20260717000003` / `20260717000004`).

**Who reads the registry:**

- **Navigation** (web dashboard nav, mobile dashboard) renders only the entries
  that are `enabled`, match the current platform, and pass the
  `requiredPermission` / `ownerOnly` check (reusing `@platform/auth`
  `hasPermission` and `isPlatformOwner`). The nav stops hardcoding links.
- **Route guards** (`requireFeatureAccess(id)`) look the entry up and enforce
  `enabled` + permission/owner **server-side** — the page guard remains the real
  boundary, exactly as today; hiding a nav link is only UX.

The registry is **the** place that decides what exists. The "5 destinations" in
the fan-menu experiment were a visual preview of this exact idea: a list that
drives a menu.

---

## 5. Dependency rules

- A feature may depend on **shared packages** (`@platform/auth`, `@platform/db`,
  `@platform/i18n`, `@platform/core`, …) and on platform services.
- A feature must **never** import another feature. If feature B needs something
  from feature A, that something graduates into a shared package.
- Direction is one-way: **apps → packages**, **features → packages**, never the
  reverse and never sideways. This is CLAUDE.md rule #4 extended to features and
  is what makes deleting a feature safe: nothing else points at it.

---

## 6. Cross-cutting surface — what a feature can span

A heavy feature can touch up to six places. Knowing the full list is what makes
add/remove predictable:

| Concern | Where | Required? |
|---|---|---|
| UI + view | `apps/web/src/features/<id>/`, `apps/mobile/<id>/` | yes |
| Route shell | `app/[locale]/dashboard/<id>/page.tsx` | yes (if it has a screen) |
| Registry entry | `@platform/core` `FEATURES[]` | yes |
| Shared logic | `packages/core/src/features/<id>/` (or its own package) | only if reused |
| i18n strings | `@platform/i18n` — **one namespace per feature** (`"<id>": {…}`) | if it shows text |
| Permission(s) | the catalog in `@platform/auth` (+ DB migration if DB-enforced) | only if access-controlled |
| DB tables + RLS | `packages/db/migrations/<ts>_<id>_*.sql` | only if it stores data |

---

## 7. Adding a feature — checklist

1. Choose a stable **id** (slug). It will appear in the folder, route, i18n
   namespace, and migration names.
2. **Shared logic** (only if reused): add it under `packages/core/src/features/<id>/`
   (React-free) or create a dedicated package.
3. **UI**: create `apps/web/src/features/<id>/` with `index.ts` + `<Name>View`.
4. **Route shell**: add the thin `page.tsx` with `requireFeatureAccess('<id>')`.
5. **i18n**: add a `"<id>"` namespace to each locale in `@platform/i18n`.
6. **Permission(s)** (if access-controlled): add to the `@platform/auth` catalog;
   if DB-enforced, add an RLS migration (see ARCHITECTURE.md #14).
7. **DB** (if it stores data): one or more migrations named `<ts>_<id>_*.sql`,
   with RLS for tenant isolation (ARCHITECTURE.md #11). Keep all of a feature's
   migrations grouped and prefixed by the id.
8. **Registry**: add **one** `FeatureDefinition` entry. Nav + guards pick it up.
9. **Mobile** (optional / later): mirror the screen under `apps/mobile/<id>/`,
   reusing the shared logic; set `platforms: ['web','mobile']`.
10. Update docs and commit (Conventional Commits, e.g. `feat(calendar): …`).

---

## 8. Removing or disabling a feature

There are two levels, and they cost very different amounts:

**Disable (reversible, recommended first):**
- Set `enabled: false` on the registry entry. Nav link and route access vanish
  everywhere; the code stays in the tree, dormant and harmless. This is the
  "remove a feature" path you want most of the time.

**Delete fully (UI/route layer — cheap):**
- Delete `apps/web/src/features/<id>/` (and the mobile counterpart).
- Delete the route shell `app/[locale]/dashboard/<id>/page.tsx`.
- Delete the registry entry.
- Delete the `"<id>"` i18n namespace.
- Because of the one-way dependency rule, nothing else references it — so this
  cannot break another feature.

**The DB is the part that does NOT uninstall cleanly:**
- Migrations are **forward-only** in practice. Do **not** casually `DROP TABLE`.
- A dormant feature's tables, with RLS still on, are **harmless** — leave them.
- If you truly must remove schema, write a **new, deliberate down-migration**
  and review it like security-sensitive work (it is). Permissions in the catalog
  can likewise be left in place or removed via a reviewed migration.
- Design implication: keep a feature's tables **self-contained** (its own
  `organization_id`-scoped tables, no other feature's FKs pointing in) so that
  leaving them dormant — or removing them later — never entangles anything else.

The fan-menu experiment is the trivial end of this spectrum: pure UI, no route,
no DB, no permission — so it removes in two lines. Real features sit further
along, which is exactly why the layers above are kept loosely coupled.

---

## 9. Naming conventions

- **Feature id / folder / route**: lowercase slug, singular domain noun
  (`chat`, `calendar`, `invoice`). Same string everywhere.
- **i18n namespace**: the feature id (`"calendar": { … }`).
- **Permission keys**: `<feature>.<action>` (the one live key today is
  `members.manage`; `roles.manage` and `users.view` were deleted as dead).
- **Migration files**: `<timestamp>_<id>_<what>.sql` so a feature's schema is
  greppable as a group.
- **Commit scope**: the feature id (`feat(calendar): add month view`).

---

## 10. Feature flags & per-tenant enablement (future)

`enabled` is a global kill switch today. Because the platform is multi-tenant,
a natural future step is **per-organization** enablement (org A gets *Invoices*,
org B does not) via an `enabledForOrg(orgId)` resolver on the definition, backed
by an `org_features` table. That capability is itself a feature and should be
built as one — but designing the registry around a `FeatureDefinition` now means
adding it later is additive, not a rewrite.

---

## 11. What NOT to build (yet)

Do **not** build a dynamic plugin runtime with auto-discovery / dynamic imports
at this stage. For the current team size it is over-engineering. A documented
convention (this file), a consistent folder shape, the declarative registry, and
strict one-way dependencies give 90% of the benefit with none of the complexity.
Revisit auto-loading only if multiple independent teams start shipping features
in parallel.
