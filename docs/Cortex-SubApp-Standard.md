# Cortex — Sub-App Standardization Contract

### The binding contract every tool must satisfy · End-to-end reference example: **Inventory**

**Version:** 1.3 · Binding contract (not a suggestion)
**Stack:** React + TypeScript + Supabase (Postgres + RLS + Edge Functions)
**Usage:** The permanent context file that every new tool build with Claude Code starts from.

> **Changed in 1.3:** §6 rewritten to match the real schema — role-based RLS replaced by the
> `private.auth_user_has_permission` / `auth_user_is_member_of` helpers; §9 DB checklist item
> corrected; new §11 records that the access/visibility model is NOT YET DECIDED (no new tool
> table or write policy until it is).

> **The rule we never move from:** The AI never touches SQL. It only calls Intents. Every Intent
> goes through one data-layer that enforces permissions, adds the standard fields, and writes an
> audit record. Every tool talks outward ONLY through Intents and Events — it never reads another
> tool's tables directly.

---

## 1. Architecture principles (7 laws)

1. **Thin shell.** The super-app holds navigation, auth, identity, AI, registry, and the
   event-bus. ZERO business logic. The shell doesn't know what "inventory" is — only how to host it.
2. **A tool = an independent unit.** One folder, fixed files, upgrades independently.
3. **Communication only through the contract.** Intents (directed requests) + Events (chain
   reactions). No direct access between tools.
4. **One DB, a namespace per tool.** Not microservices. Logical isolation + cross-tool queries
   remain possible.
5. **Three mandatory fields on every tool table:** `instance_id`, `owner_id`, `org_id`. They
   enable isolation, permissions, and uniform RLS.
6. **Design & language are consumed, not invented.** One central design-system + one i18n.
   A tool NEVER defines a colour (no hex/rgb/hsl, no default-Tailwind palette, no arbitrary
   `bg-[#…]`) — it uses only token-backed utilities, from two families that are never mixed:
   semantic roles (for meaning) and the app-identity palette (for its own identity). It supplies
   translation keys, never hard-coded text. The concrete rules are in §8.
7. **AI through one door.** Every AI read/write goes through the data-layer, which enforces the
   contract and writes to `ai_log`.

---

## 2. File template for every tool

```
/apps/cortex/src/tools/inventory/
  manifest.ts        # identity: who I am, what I need, what I emit/listen to
  intents.ts         # the AI API: actions + input/output schema  ← "the connection file"
  schema.sql         # the tool's tables (with the 3 mandatory fields + RLS)
  logic.ts           # internal business logic + event emission
  events.ts          # which events the tool emits / listens to
  views/
    FullScreen.tsx   # full screen (consumes the design-system)
    DashboardCard.tsx# card for the dashboard / overview
  i18n/
    he.json  en.json
```

Rule: every file has the same name and the same role in every tool. Claude knows exactly what to
look for in each new tool.

---

## 3. The Manifest — identity card

```typescript
// tools/inventory/manifest.ts
import type { AppManifest } from '@platform/cortex-core';

export const manifest: AppManifest = {
  id: 'inventory',
  version: '1.0.0',
  name: { key: 'inventory.name' },        // i18n key, not hard-coded text
  category: 'business',
  icon: 'box',
  color: 'amber',                          // from the design-system palette only

  // permissions the tool needs from the shell
  permissions: ['org.read', 'org.write'],
  roles: ['owner', 'manager', 'employee'],

  // dependency on the shell: received ready, not managed by the tool
  requires: ['auth', 'org-context'],

  // what the tool emits and listens to (short; full detail in events.ts)
  emits:    ['inventory.low', 'inventory.updated'],
  listensTo:['orders.received'],           // a delivery note approved → update stock

  // declaration to the AI: which topics the tool can handle
  aiTopics: ['inventory', 'products', 'quantities', 'shortages', 'stock count'],
};
```

---

## 4. Intents — the AI API ("the connection file")

This is the file that makes the tool available to the AI. The AI doesn't know how inventory is
built; it only sees the list of actions and their schemas.

```typescript
// tools/inventory/intents.ts
import { z } from 'zod';
import { defineIntent } from '@platform/cortex-core';
import { inventoryLogic } from './logic';

export const intents = [
  defineIntent({
    name: 'inventory.query_stock',
    description: 'How much of a given product, or of all products, is left',
    input:  z.object({ product: z.string().optional() }),
    output: z.array(z.object({ name: z.string(), quantity: z.number(), unit: z.string() })),
    handler: (input, ctx) => inventoryLogic.queryStock(input, ctx),
  }),

  defineIntent({
    name: 'inventory.update_quantity',
    description: 'Update a product quantity (add / subtract / set)',
    input:  z.object({ product: z.string(), delta: z.number().optional(), setTo: z.number().optional() }),
    output: z.object({ name: z.string(), quantity: z.number() }),
    handler: (input, ctx) => inventoryLogic.updateQuantity(input, ctx),  // → may emit inventory.low
  }),

  defineIntent({
    name: 'inventory.add_product',
    description: 'Add a new product to inventory',
    input:  z.object({ name: z.string(), quantity: z.number(), unit: z.string(), reorderThreshold: z.number() }),
    output: z.object({ id: z.string() }),
    handler: (input, ctx) => inventoryLogic.addProduct(input, ctx),
  }),
];
```

**Intent contract rules (identical for every tool):**
- Name is always `<appId>.<action>`.
- Input/output defined with `zod` — this is what gives the AI type safety and validation.
- The `handler` receives `ctx` (userId, orgId, instanceId) from the shell — it does NOT fetch it
  itself.
- The handler never writes SQL directly — it calls `logic`, which calls the data-layer.

---

## 5. Events — the chain reaction

```typescript
// tools/inventory/events.ts
import { defineListener } from '@platform/cortex-core';
import { inventoryLogic } from './logic';

// Emits: documented here, fired from logic.ts
// 'inventory.low'     → { product, quantity, threshold }
// 'inventory.updated' → { product, quantity }

// Listens: a delivery note approved in the orders tool → add to stock
export const listeners = [
  defineListener('orders.received', (payload, ctx) =>
    inventoryLogic.applyDelivery(payload.items, ctx)
  ),
];
```

**The "low stock" flow end-to-end (this is the whole magic of the platform):**

```
user/AI calls inventory.update_quantity (tomatoes -10)
        │
   logic.updateQuantity → writes via the data-layer
        │
   did quantity drop below reorder_threshold?
        │ yes
   emits event: 'inventory.low' { product:'tomatoes' }
        │
   the bus fans out to listeners — inventory doesn't know who they are:
        ├─ tasks   listens → creates a task "reorder tomatoes" (auto-generated)
        ├─ finance listens → flags an expected expense
        └─ shell   listens → pushes an actionable notification "reorder now"
```

The emitting tool is fully decoupled from the listeners. Tomorrow you add a "smart suppliers"
tool that listens to `inventory.low` and auto-orders — WITHOUT touching the inventory code.

---

## 6. Database standard

```sql
-- tools/inventory/schema.sql

create table inventory_items (
  id          uuid primary key default gen_random_uuid(),

  -- ===== the three mandatory fields (on every tool table, no exceptions) =====
  instance_id uuid not null references app_instances(id) on delete cascade,
  owner_id    uuid not null references users(id),
  org_id      uuid references organizations(id),      -- org scope; nullability NOT YET DECIDED (see §11)
  -- ===========================================================================

  name              text not null,
  quantity          numeric not null default 0,
  unit              text not null default 'unit',
  reorder_threshold numeric not null default 0,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- indexes on the isolation fields
create index on inventory_items (instance_id);
create index on inventory_items (org_id);

-- uniform Row-Level Security (same pattern in every tool)
alter table inventory_items enable row level security;

-- READ — your own record, or any record in an org you actively belong to.
create policy "read own or org" on inventory_items for select
  using ( owner_id = (select auth.uid())
          or private.auth_user_is_member_of(org_id) );

-- WRITE — only with the required permission IN THAT ROW'S org.
-- (Illustrative only — see §11: no tool may ship a write policy until the access
--  model is decided. When it is, the permission key must be a real row in the
--  `permissions` catalog.)
create policy "write by permission" on inventory_items for all
  using      ( private.auth_user_has_permission(org_id, 'inventory.write') )
  with check ( private.auth_user_has_permission(org_id, 'inventory.write') );
```

**The two helpers are THE standard — not an optional deviation.** `public.memberships` has no
`role` column, so `role in ('owner','manager')` is not expressible; roles live in `roles` +
`membership_roles` (composite FKs pin both a membership and a role to one org), each role carrying
an `is_admin` flag.

- **`private.auth_user_is_member_of(org_id)`** — the canonical membership check for READ. It is
  `deleted_at`-aware: a membership counts only if the membership AND its organization are both
  active, so a soft-deleted org/membership cascades to "hidden" for free (migration
  `20260610000001_soft_deletes.sql`).
- **`private.auth_user_has_permission(p_org_id uuid, p_permission_key text)`** — the canonical
  permission check for WRITE. `SECURITY DEFINER`, `STABLE`, `SET search_path = ''`, fully
  schema-qualified (so it bypasses RLS on the joined tables without recursing). Returns true when
  the caller has an active membership in `p_org_id` whose role is `is_admin` OR is linked via
  `role_permissions` to a permission with key `p_permission_key`. Defined in
  `20260608000003_membership_roles_write_policy.sql` and made `deleted_at`-aware in
  `20260610000001_soft_deletes.sql`.

**Three table layers in the DB (all in the same Postgres):**

| Layer | Tables | Who touches |
|-------|--------|-------------|
| **Shell** | `users`, `organizations`, `memberships`, `app_definitions`, `app_instances`, `events`, `ai_log` | the shell only |
| **Tools** | `inventory_items`, `orders`, `tasks`, `finance_entries`… (each with the 3 mandatory fields) | the tool via the data-layer |
| **Generative** | `app_records` (a single JSONB `data` column) | tools the AI generates on the fly |

**Namespace:** a naming convention — every tool table is logically prefixed with the tool id
(`inventory_*`). No separate Postgres schema; isolation is via RLS + the 3 mandatory fields. This
is simpler to maintain for a solo builder and allows cross-tool JOINs when the AI needs them.

Note: `app_definitions` is the GLOBAL catalog (shared by all) — it does NOT need `owner_id`. The
3 mandatory fields apply to TOOL tables, not to shell catalog tables.

---

## 7. The Data / AI layer (the one door)

```typescript
// @platform/cortex-core — every read/write goes through here. There is no other way.
export async function runIntent(intentName: string, input: unknown, ctx: Ctx) {
  const intent = registry.getIntent(intentName);          // from all registered tools
  const parsed = intent.input.parse(input);               // zod input validation

  assertPermissions(ctx, intent.appId);                   // enforce permissions from manifest
  const result = await intent.handler(parsed, ctx);       // the tool runs with ready ctx

  await log('ai_log', { intent: intentName, ctx, input: parsed });  // mandatory audit
  return intent.output.parse(result);                     // output validation
}
```

**Why this delivers exactly what's required** ("the way the AI reads/writes data is identical for
all"): every tool, every action, the same path — `runIntent`. The AI gets a list of intents from
all installed tools, picks one, and calls it. It never sees a table. The standard fields and the
audit are enforced in one place.

---

## 8. Design & language — consumed from the center

```typescript
// views/DashboardCard.tsx — built from tokens, not raw styles
import { Card, Stat, useT } from '@/design-system';   // or the app's equivalent

export function DashboardCard({ data }) {
  const t = useT('inventory');                    // central i18n
  return (
    <Card accent="amber">                          {/* color from the palette only */}
      <Stat label={t('low_items')} value={data.lowCount} tone="alert" />
    </Card>
  );
}
```

- **Design tokens** (color, radius 10–18, typography, spacing, shadows) are defined once in the central
  design-system. A tool picks an `accent` from a closed palette.
- **i18n** — the tool supplies only `he/en.json` with keys. No hard-coded text. RTL/LTR handled
  centrally.

**Token rules (binding):**

- **A sub-app NEVER defines colours.** No hex, no `rgb()/hsl()`, no default-Tailwind palette classes
  (`bg-gray-400`, `bg-white`, `text-slate-600`), no arbitrary colour values (`bg-[#…]`). Only
  token-backed utilities. (The default Tailwind palette is disabled at the framework level — those
  classes resolve to nothing.)
- **Two token families, never mixed:**
  - *Semantic roles* — `accent`, `success`, `warning`, `danger`, `inverse` / `inverse-ink`, `scrim`,
    `ring`, `on-fill`, plus neutrals `screen` / `card` / `ink` / `muted` / `hairline`. Use these for
    MEANING (this is a warning; this is the primary action).
  - *App identity palette* — `app-violet` / `app-teal` / `app-coral` / `app-amber` / `app-blue` /
    `app-green`. A sub-app picks ONE via `manifest.color` and uses it ONLY for its own identity
    (its icon, its primary action).
  - **Canonical example (the real Inventory tool):** the icon disc and the "add product" button are
    `app-amber` (identity); the low-stock badge is `warning` (meaning). They look the same today and
    are independent knobs tomorrow. Never use a semantic role as decoration, and never use an app
    colour to signal a state.
- **Text/icons on ANY saturated fill use `on-fill`** — never `text-white`.
- **`ink` is a TEXT role.** Never use it as a surface (`bg-ink`). A surface opposite the screen is
  `inverse` + `inverse-ink`.
- **Backdrops use `scrim`** — no ad-hoc `bg-ink/30`.
- **Radii come from the token scale** (`rounded-md` / `-lg` / `-xl` / `-pill`). No arbitrary radii.
- **List rows inside a card have no fill and no radius** — they sit on the card surface, separated
  by a hairline and spacing. A card is a box; its contents are not.
- **Theme-author constraint:** every saturated fill in a theme MUST sit in the same lightness band,
  because `on-fill` is a single token shared by all of them.
- **Single source of truth:** a theme is ONE entry in `themes` (`design-system/tokens.ts`) carrying
  its own values AND its own `labelKey`. Never a list parallel to it. (We have been burned twice:
  `placeholder-apps.tsx` vs the registry, and `LABEL_KEY` vs `themes`.)
- **Interaction feedback is consumed, not invented.** Every pressable element uses `.interactive`
  — never a bespoke hover colour, `active:opacity-*`, or an ad-hoc scale. Small controls press to
  `0.97` (`motion-safe:active:scale-[0.97]`); cards and rows do NOT scale, overlay only. Focus is
  `:focus-visible` with the `ring` token.

---

## 9. "Tool ready" checklist (Definition of Done)

- [ ] `manifest` complete: id, permissions, roles, emits, listensTo, aiTopics.
- [ ] `intents` — every action with zod input/output, name `<appId>.<action>`, handler using `ctx`.
- [ ] `schema.sql` — every table with `instance_id` + `owner_id` + `org_id`; RLS uses the standard helpers (`private.auth_user_is_member_of(org_id)` for READ, `private.auth_user_has_permission(org_id, '<key>')` for WRITE) — never a `memberships.role` check. Subject to §11: no NEW tool table and no write policy until the access model is decided.
- [ ] `events` — every emitted event documented; every listener registered.
- [ ] Zero SQL inside handlers — everything through the data-layer.
- [ ] Zero direct access to another tool's table.
- [ ] `views` built from the design-system only; zero hard-coded color/radius.
- [ ] Colours are token-backed utilities only — no hex/rgb/hsl, no default-Tailwind palette, no `bg-[#…]`.
- [ ] Semantic roles used for MEANING; the app-identity palette (`app-*`, one per `manifest.color`) used ONLY for identity — the two are never crossed.
- [ ] Text on any fill is `on-fill` (never `text-white`); `ink` is text-only (never `bg-ink`); backdrops are `scrim`.
- [ ] Radii from the token scale (`rounded-md/lg/xl/pill`) — no arbitrary radii.
- [ ] Every pressable element uses `.interactive` (overlay + focus) — no bespoke hover/press colour or ad-hoc scale; small controls press to `0.97`, cards/rows do not scale.
- [ ] Zero hard-coded text — everything i18n.
- [ ] No user/auth management inside the tool — received from the shell.

---

## 10. Instruction for Claude (before building any tool)

> You are building a sub-app for the Cortex platform. Follow this standardization contract
> exactly: the file template in §2, the manifest/intents/events formats, the three mandatory
> fields and RLS in §6, and the data-layer/runIntent flow in §7. The tool talks outward only
> through Intents and Events. No direct access to other tools' tables. No SQL inside handlers.
> Design and language are consumed from the design-system and i18n only. Run through the §9
> checklist before you finish.

---

## 11. Access model — NOT YET DECIDED

The visibility / access model for tool data is **under active design**. It is not settled, and the
§6 example above shows the *mechanism* (the standard helpers), not a finalized policy. Still open:

- Whether `org_id` is nullable (a "personal tool has no org") or always required.
- Whether `instance_id` survives at all as a mandatory field.
- Per-record visibility (owner-only vs org-wide vs something finer).
- The write path — which permission keys exist, and how a tool declares the one it needs.

**Until this is decided:**

- **No new tool table may be created.**
- **No tool may ship a write policy.**

The Inventory tool's tables exist but are **EMPTY**, and are **expected to be dropped and rebuilt**
once the model lands. Treat everything in §6 as provisional against that outcome.
