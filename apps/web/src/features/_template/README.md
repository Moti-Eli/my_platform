# Feature template (reference scaffold)

Copy this folder to `apps/web/src/features/<id>/` to start a new web feature.
It is **reference only** — nothing imports it and it registers **no route**. See
[`FEATURES.md`](../../../../../FEATURES.md) at the repo root for the full convention.

## Folder shape (FEATURES.md §3)

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

Shared, React-free logic does **not** live here — it graduates to a package
(`packages/core/src/features/<id>/` or its own `@platform/*`), so web and mobile
can both use it.

## Route shell (documentation — not a real file in this folder)

The route is a thin shell: guard + import + render, nothing else. In Phase 2 the
`requireFeatureAccess` helper looks the feature up in the `@platform/core`
registry and enforces `enabled` + permission/owner **server-side** (the real
boundary; hiding a nav link is only UX).

```tsx
// apps/web/src/app/[locale]/dashboard/<id>/page.tsx — thin shell only
import { requireFeatureAccess } from "@/lib/feature-guard"; // arrives in Phase 2
import { ExampleView } from "@/features/<id>";

export default async function Page() {
  await requireFeatureAccess("<id>"); // redirects if not allowed (the real boundary)
  return <ExampleView />;
}
```

> The `requireFeatureAccess` guard helper does **not** exist yet — Phase 1 is the
> registry + convention only. Do not create a live `page.tsx` from this snippet
> until Phase 2 lands the guard.

## Registry entry (the one wiring point)

Add a single `FeatureDefinition` to `FEATURES` in
`packages/core/src/features/registry.ts`:

```ts
{
  id: "<id>",
  route: "dashboard/<id>",        // full path after the locale prefix
  labelKey: "<id>.navLabel",
  icon: "<icon-id>",
  requiredPermission: null,        // or a PermissionKey; ownerOnly?: true for owner-only
  platforms: ["web"],              // add "mobile" when the mobile screen exists
  enabled: true,
}
```
