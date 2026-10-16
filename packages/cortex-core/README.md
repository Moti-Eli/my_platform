# @platform/cortex-core

The **core engine** of Cortex — a super-app platform that *hosts* tools. It is a
thin shell with **zero business logic**: it knows how to register tools, run
their intents through one audited door, and fan out events — nothing about what
any individual tool (inventory, orders, tasks…) actually does.

Built to the binding contract **`Cortex-SubApp-Standard.md`** (§1 types, §6 DB
standard, §7 data-layer). This package is the *core* only — there are no
sub-apps, no UI, and no AI model calls yet.

## What's here

| Piece | File | Role |
|---|---|---|
| Contract types | `src/types.ts` | `Ctx`, `AppManifest`, `Intent`, `Listener` (Standard §1) |
| Registry | `src/registry.ts` | tools `registerApp(manifest, intents, listeners)`; look up intents/listeners |
| Data-layer | `src/data-layer.ts` | `runIntent` — the **one door**: validate → permit → run → audit → validate (§7) |
| Event-bus | `src/event-bus.ts` | `emit(type, payload, ctx)` — persist to `events`, then dispatch to listeners |
| DB port | `src/db.ts` | `CortexDb` (the "provided db client") + an in-memory adapter for tests |
| Smoke demo | `src/__demo__/smoke.ts` | end-to-end acceptance proof (registry + runIntent + event-bus + db) |

## The one door (`runIntent`)

`runIntent(intentName, input, ctx)` is the **only** way anything (the AI
included) reads or writes tool data. Every call runs the same pipeline (§7):

1. resolve the intent from the registry (`<appId>.<action>`);
2. **zod-validate** the input;
3. **enforce** the manifest's permissions (`assertPermissions(ctx, appId)`);
4. run the tool's `handler(input, ctx)` — the handler gets a ready-made `ctx`
   and never fetches identity itself, and never writes SQL except via a db
   client it closed over;
5. write the mandatory **`ai_log`** audit row;
6. **zod-validate** the output and return it.

```ts
import { createDataLayer, createEventBus, registerApp } from "@platform/cortex-core";

registerApp(manifest, intents, listeners);          // at startup, per tool
const { runIntent } = createDataLayer({ db, assertPermissions });
const { emit } = createEventBus(db);

const out = await runIntent("inventory.addItem", input, ctx);
await emit("inventory.item_added", out, ctx);
```

`db` is any `CortexDb`; the shell passes a Supabase-backed adapter running as
`service_role` (shell writes bypass RLS). `assertPermissions` defaults to a
fail-closed local check and is replaced by the shell with a full
`@platform/auth` RBAC check.

## Run the smoke test

```bash
pnpm --filter @platform/cortex-core smoke
```

Registers a dummy `ping` app, calls `runIntent('ping.echo', …)`, emits
`ping.fired`, and asserts the listener ran and rows landed in `ai_log`/`events`
— all in-memory, no live database required.

## Database

The four shell tables (`app_definitions`, `app_instances`, `events`, `ai_log`)
are defined in the migration
`packages/db/supabase/migrations/20260714000001_cortex_shell_tables.sql`
(additive; RLS per Standard §6 — see that file and `packages/db/SCHEMA.md`).

## Boundaries

- Additive and isolated: depends only on `zod`. Does **not** import existing
  app/auth/chat code.
- No business logic (Standard §1 law 1). Tools bring the domain; the core only
  hosts them.
