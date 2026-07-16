# Cortex — Roadmap

The single source of truth for build order. Read this before planning any
Cortex DB or auth work. Update the status table when a step lands.

## Where this fits

- `docs/Cortex-SubApp-Standard.md` — the sub-app contract (SEE KNOWN DEBTS: §2
  and §6 are stale).
- This file — build order and what is still open.
- `packages/db/README.md` — the migration list.

## The access model (locked — do not relitigate)

Four questions, four answers, one enforcement point:

| Question | Answered by |
|---|---|
| Who are you? | `users` |
| Where are you? | `memberships` |
| What may you do? | `roles` + `permissions` (exists in my-platform) |
| Which row? | `visibility` + `record_grants` (being built) |

Flat ReBAC in Postgres. NOT OpenFGA/SpiceDB — RLS is the asset; an external
engine removes it from the loop (Postgres cannot call HTTP mid-query) and
breaks Realtime.

Mandatory helper shape: `SECURITY DEFINER`, `STABLE`, `set search_path = ''`,
`deleted_at`-aware. Pattern reference: `private.auth_user_is_member_of`.

### The rule that everything rests on

Membership is a BLOCKING condition, never an alternative:

    can_read(row) =
      is_member_of_tree(org_id)          <- AND. always. blocks first.
      AND ( visibility = 'org'
            OR (visibility = 'private'    AND owner_id = auth.uid())
            OR (visibility = 'restricted' AND a grant exists: user|role|group) )

`can_write` / `can_grant` follow the same shape.

The old `owner_id = auth.uid() OR is_member(org)` was a bug: the left branch
bypassed membership, so a departed employee kept reading org data. It existed in
three tables, all of which were rebuilt in step 3. Never reintroduce the OR.

Inheritance flows DOWNWARD ONLY: a member of a parent org reads a child's rows;
a member of a child reads nothing of the parent's.

## Status

| # | Step | Blocks login? | State |
|---|---|---|---|
| 2 | `organizations.parent_id` + `is_member_of_tree` | — | DONE, pushed |
| 3 | drop+rebuild Cortex tables: `-instance_id`, `org_id` NOT NULL, `+visibility` | — | DONE, NOT pushed |
| 4a-1 | `groups` + `group_members` | — | DONE, NOT pushed |
| 4a-2 | `record_grants` + subject-in-tree trigger | — | DONE, NOT pushed |
| 4b-1 | `can_read` + wire inventory_items | no (1) | DONE, NOT pushed |
| 4b-2 | `can_write` / `can_grant` | no (1) | DONE, NOT pushed |
| 4c | trigger: `visibility` / `org_id` / `owner_id` immutable | YES | DONE, NOT pushed |
| 4d | `shell.grant_access` — the only door to granting | YES | DONE, NOT pushed |
| 3b | `events.org_id` NOT NULL + add `ai_log.org_id` | YES | debt, dropped mid-session |
| 5 | split `members.manage` / `members.manage_admins`; delete `users.view` | YES (2) | |
| 6 | personal organization on signup (trigger + role bundle) | YES | |
| 7 | Cortex -> real DB -> auth -> inventory end-to-end | — | FIRST REAL USERS |
| 8 | `connections` + messaging (cross-org) | no | off the critical path |

(1) Step 4b does not block reading. The current policy —
    `is_member_of_tree(org_id) AND visibility = 'org'` — works and fails closed.
    4b EXTENDS it to `private` / `restricted`. It is an extension, not a
    precondition.
(2) Step 5 blocks only because step 6 seeds roles. Ordering matters: if 6 runs
    first it seeds the OLD permission vocabulary, and 5 then needs a data
    migration over auto-created roles. 5 MUST precede 6.

Step 6 is not optional. `org_id` is NOT NULL on every Cortex table, so a new
signup with zero memberships cannot install an app or see anything. Without it,
step 7 shows an empty screen on day one and it will look like a bug.

## Known debts — flagged, deliberately deferred

1. `docs/Cortex-SubApp-Standard.md` §2 mandates a per-tool `schema.sql`. That
   file was deleted for inventory in step 3; the migration is the single source
   of truth. §6 still lists `instance_id` as one of three mandatory tool fields.
   `instance_id` is gone — branches are child organizations. A tool built from
   the Standard today would recreate both mistakes. Fix after step 4b, when the
   §6 rewrite can happen once.

2. `apps/cortex/src/cortex/apps.ts` holds 19 manifests in code, while
   `app_definitions` is a table for manifests with 0 rows. Two sources of truth
   for one manifest. A manifest declares intents, and intents are functions — so
   the manifest is code. Either the table is seeded from code at startup (a
   projection), or it is dead weight. Decide in step 7.

3. `apps/cortex/src/tools/inventory/logic.ts` and `Ctx.instanceId` in
   `packages/cortex-core/src/types.ts` still scope reads by `instance_id`, a
   column that no longer exists. Typecheck does not catch it (`db.insert` takes
   a loose `DbRow`) and runtime does not exist yet (inventory is in-memory).
   Rewire in step 7.

## Standing rules

- One source of truth. No parallel lists. (Burned three times.)
- Prompts stay small: one prompt, one stable change.
- Risk-scaled checks: DB/auth/permissions -> typecheck + lint + full DB
  harnesses. Visual-only -> typecheck.
- Migrations are forward-only. Never edit an applied migration; supersede it.
  Precedent: `20260610000003`.
- Run the Supabase CLI from `packages/db`, NEVER from the repo root. Running it
  from the root creates a stray `supabase/` directory that makes `db push` see
  zero local migrations and propose `migration repair` — which would mark 17
  healthy migrations as reverted. This has already happened twice.
- Every harness must be proven non-vacuous: mutate the thing under test,
  confirm the expected assertions fail, restore.
- RLS is the enforcement point. `service_role` is not a substitute for it.
