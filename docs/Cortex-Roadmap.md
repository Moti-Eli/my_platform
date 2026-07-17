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
| 3 | drop+rebuild Cortex tables: `-instance_id`, `org_id` NOT NULL, `+visibility` | — | DONE, pushed |
| 4a-1 | `groups` + `group_members` | — | DONE, pushed |
| 4a-2 | `record_grants` + subject-in-tree trigger | — | DONE, pushed |
| 4b-1 | `can_read` + wire inventory_items | no (1) | DONE, pushed |
| 4b-2 | `can_write` / `can_grant` | no (1) | DONE, pushed |
| 4c | trigger: `visibility` / `org_id` / `owner_id` immutable | YES | DONE, pushed |
| 4d | `shell.grant_access` — the only door to granting | YES | DONE, pushed |
| 4e | tighten client grants: Cortex tables + future public tables | — | DONE, pushed |
| 3b | `events.org_id` NOT NULL + add `ai_log.org_id` | YES | DONE, pushed |
| 5 | forbid role-assignment escalation (trigger, NOT the split — see (3)); delete `users.view` | YES (2) | DONE, pushed |
| 6 | personal organization on signup (trigger + role bundle) | no (4) | not a blocker — see below |
| 7 | Cortex -> real DB -> auth -> inventory end-to-end | — | IN PROGRESS (7a-7d pushed) |
| 7a | `Ctx` scoped by `org_id`; `instance_id` demoted to audit metadata | — | DONE, pushed |
| 7b | auth + active-org resolution; per-page `requireSession()` guards | — | DONE, pushed |
| 7b' | login moved out of `AppShell` into `(auth)` / `(app)` route groups | — | DONE, pushed |
| 7c | `runIntent` server-side; Supabase `CortexDb` adapter; reads via RLS | — | DONE, pushed |
| 7d | sign-out | — | DONE, pushed |
| 8 | `connections` + messaging (cross-org) | no | off the critical path |

Remote migration count: **28** (`20260605000001` … `20260717000003`) — verified as
28 committed migration files, all git-tracked, on `feat/cortex-shell` which is in
sync with origin, and all 28 applied on the local stack. The remote DB itself was
NOT queried (db-guard refuses non-local; the publishable key returns 401 on
member-gated tables) — see the last standing rule.

(1) Step 4b does not block reading. The current policy —
    `is_member_of_tree(org_id) AND visibility = 'org'` — works and fails closed.
    4b EXTENDS it to `private` / `restricted`. It is an extension, not a
    precondition.
(2) Step 5 blocks only because step 6 seeds roles. Ordering matters: if 6 runs
    first it seeds the OLD permission vocabulary, and 5 then needs a data
    migration over auto-created roles. 5 MUST precede 6.
(3) The `members.manage` / `members.manage_admins` SPLIT was dropped, deliberately.
    `20260717000003` enforces the boundary with a trigger instead, which makes the
    permission unenforceable-by-construction: assigning an is_admin role already
    requires holding one, and every is_admin holder implicitly has all permissions
    via `auth_user_has_permission`'s `r.is_admin` branch — so the new key would be
    granted-but-never-fired, the same defect that step deletes `users.view` for.
    Step 6 now has a hard dependency on 5's BOOTSTRAP exemption: the escalation
    trigger fires for `service_role` too, so a personal org's first admin role can
    only be assigned while that org has zero role rows. Build 6 to place exactly
    ONE membership_roles row per new org; a second no-JWT insert raises.
(4) Step 6 does NOT block login and is not on the current critical path — see below.

Step 6 is not a login blocker. There is no `signUp` call anywhere in the repo:
every account is provisioned WITH a membership (the admin/owner create paths), so
"zero memberships" is unreachable through the UI, and `org_id` NOT NULL on every
Cortex table never strands a real user today. Step 6 is therefore not "add a
trigger to signup" — it is "build self-service signup", a product decision, and
the personal-org trigger is its second half. Note (3) still governs how that
trigger must behave when it is built: exactly one `membership_roles` row per new
org, because the bootstrap exemption fires only while an org has zero role rows.

## Decisions and why

Settled. Here because the reasoning is not visible in the code; without it the
next session will relitigate and land elsewhere.

- **`can_grant` is narrower than `can_read`/`can_write` on purpose:** restricted
  only, `access='grant'` only. No `'org'` branch — the whole tree already reads
  those rows, so a grant on one is a no-op that only mints dead rows in a security
  table. No owner branch — `can_read`'s `private` branch has no grant branch at
  all, so a grant on a `private` row could never fire for anyone; and `visibility`
  is immutable, so a `private` row cannot be upgraded to `restricted` to share it.
  A row meant to be shared is born `restricted`.

- **`members.manage` was NOT split into `members.manage_admins`.** With the
  escalation trigger, a permission gating "may assign admin roles" could never
  fire: assigning an `is_admin` role already requires holding one, and any holder
  has every permission via `auth_user_has_permission`'s `r.is_admin` branch. It
  would be granted-but-unenforceable — the exact defect `users.view` was deleted
  for.

- **The escalation trigger's bootstrap exemption is STRUCTURAL, not "service_role
  is trusted".** It fires only when an org has ZERO `membership_roles` rows,
  because in such an org nobody can hold a role and there is no question to ask.
  It is provably one-shot, and DELETE coverage is what proves it — returning an
  org to zero requires deleting its admin rows, which the same trigger blocks. The
  two halves lock each other. Honest limit: the secret key can re-arm it by
  emptying an org. Not a new hole — such a caller could just `UPDATE roles.is_admin`.

- **The trigger also exempts referential cleanup:** a row whose PARENT is already
  gone. You cannot revoke a role from a membership that no longer exists. The
  two-parent check is not defensive noise — a cascade from `organizations` hides
  both parents, from `users` only the membership, from `roles` only the role.
  Neither branch alone covers all three. Measured, not reasoned.

- **The `CortexDb` adapter resolves its RLS-scoped client PER OPERATION, not
  once.** The adapter is baked into a process-global registry that outlives a
  request, so a fixed client would serve the first caller's JWT to the next
  caller — a cross-request identity leak. `service_role` is a shared stateless
  client and is fine to hold.

- **`AUDIT_TABLES` is a closed allowlist; the default route is the RLS client.** A
  new table added without classification KEEPS enforcement and fails loudly. The
  unsafe path (service_role) is the one you opt into by name.

- **`runIntentAction` takes `(intentName, input)` and NOTHING else.** It builds
  `ctx` from `requireSession()` itself. The missing parameter IS the defence: a
  client-supplied `orgId` means the user states their own tenant, and the
  mandatory `ai_log` row would record an identity the user chose.

- **Every page calls `requireSession()` itself; the `(app)` layout provides
  chrome only.** A layout guard was rejected: Next layouts do not reliably re-run
  on client-side navigation, so it would fire once and then be trusted — the same
  failure as trusting the proxy.

- **`is_admin` is not a read superpower.** `can_read` never checks it. Layer 3 is
  "what may you do"; layer 4 is "which row". Confirmed by eye: five rows in one
  org, admin1 sees three, not five.

## How things are proven

A passing harness is not the same as a working feature. This distinction matters
more than any individual guarantee.

**PROVEN THROUGH THE REAL PATH — a browser, a cookie session, PostgREST, RLS:**
`auth_user_can_read`. Five rows sit in `inventory_items`, all in Organization A:
2 × `visibility='org'`, 1 × `private` owned by user1, 1 × `private` owned by
admin1, 1 × `restricted` with no grant. Signed in as user1: three rows. Signed in
as admin1: three rows, with a different third. Nobody sees the `restricted` row —
including its owner. Confirmed by eye, 17 Jul. Also: `requireSession()` reading
memberships through RLS; login; sign-out.

**PROVEN ONLY BY HARNESSES CONNECTING TO POSTGRES DIRECTLY — never once through
PostgREST as an authenticated client.** A review verified this and extended it:
seven of eight row-level-access guarantees are exercised only via direct-pg
impersonation or `service_role`: `is_member_of_tree`, `can_write`, `can_grant`,
`shell.grant_access`/`revoke_access`, `record_grants`' sealing and its
subject-in-tree trigger, `groups`/`group_members` composite FKs, the tool-row
immutability trigger. The role-escalation guard is the partial exception:
`membership_roles` writes DO go through real PostgREST-authenticated clients in
`verify-last-admin`, `verify-add-member` and `verify-platform-owner` — but for the
last-admin/RBAC path, not for the guard's own escalation cases. This is exactly
where a missing table privilege and a policy violation look identical, and where
`SECURITY DEFINER`'s `auth.uid()` resolution goes untested.

**BUILT BUT NEVER EXECUTED OUTSIDE A HARNESS:** `record_grants` — zero rows
anywhere; `shell.grant_access` has never been called by application code.
`groups`/`group_members` — zero rows. `can_write`/`can_grant` — created, wired to
nothing; no write policy exists.

**NOT BUILT:** the Cortex write path — `add_product`/`update_quantity` return
"unavailable" by design, because `authenticated` holds no INSERT/UPDATE on
`inventory_items`. The real RBAC checker — `defaultAssertPermissions` only asserts
the app is registered and `userId` is non-empty. Self-service signup.

## Open findings — the work queue

From a full inventory of the users/auth/DB surface, 17 Jul. Each is a fact with a
source. Nothing here is fixed.

**READY TO FIX — one migration, one pattern: vocabulary and grants the catalog
contradicts.**

A. `roles.manage` is DEAD. Zero check sites. It exists only as a type union
   (`packages/auth/src/index.ts:316`), the seed INSERT (`20260605000001:236`), and
   docs. `auth_user_may_assign_role` checks `is_admin` OR holds-that-role — never
   `roles.manage`. This is the third instance of the `users.view`/`users.invite`
   defect, and it survived two deletions because both were searched for BY NAME.
   Consequence: `members.manage` is the only live permission in the system.
   Distinction worth recording: `users.view` was WRONG (user reads are governed by
   membership); `roles.manage` is UNBUILT (there is no role-editing UI). The
   precedent is the same either way — delete it, and re-add it in the migration
   that enforces it.

B. `anon` — not just `authenticated` — holds DELETE,INSERT,SELECT,UPDATE on
   `organizations`, `memberships`, `roles`, `role_permissions`, `users`,
   `permissions` and `messages`. This roadmap previously recorded the debt as
   authenticated-only. That was wrong. RLS masks it today; it is still the only
   layer there.

C. `app_definitions` was never tightened. `20260717000001` named four tables
   (`inventory_items`, `app_instances`, `groups`, `group_members`) and
   `20260717000002` covered `events` and `ai_log` — `app_definitions` was missed by
   both and still carries the broad anon+authenticated DML grant. It is the only
   Cortex shell table that does.

D. `20260605000002:144` asserts "`anon` is granted nothing and has no policy".
   FALSE — see B. `20260609000004` stripped only truncate/trigger/references from
   `anon`; insert/update/delete were never revoked from the core tables. This is
   the same defect as `20260714000001`'s header, older and wider than recorded.

**NEEDS A DECISION — touches my-platform, the asset:**

E. `createOrganizationWithFirstAdmin`: the `membership_roles` grant at
   `packages/auth/src/index.ts:529` runs as `service_role` while the authorization
   check (`isPlatformOwner`) runs as the acting user. This is the add-member
   identity split, still live. It is currently harmless only because that row is
   the new org's first assignment and the escalation trigger's bootstrap exemption
   covers it — i.e. it is saved by an exemption, not by a check. SUSPECTED; verify
   before acting.

**HARNESS INTEGRITY — no migration needed:**

F. `verify-record-grants.ts` proves the subject-in-tree trigger with
   `error !== null` only (`:319`, `:327`, `:333`, `:382`). An FK or CHECK violation
   would satisfy it. This is the trap this repo documented — "did it throw"
   measures the schema, not the guard — in a harness written after documenting it.
   Same weakness, milder, in `verify-messages.ts:133/142`,
   `verify-groups.ts:198-214`, `verify-last-admin.ts:163/173`,
   `verify-platform-owner.ts:191/198`, `verify-org-tree.ts:214`.

G. `holdRoleAs()` in `verify-can-read.ts` and `verify-can-write-grant.ts` seeds
   post-bootstrap role assignments via `set local role service_role`, bypassing the
   `membership_roles` RLS write policy the real authenticated path must pass. The
   headers admit it. The escalation trigger is still satisfied honestly.

**CONFIRMED CLEAN — recorded so nobody re-checks:**

- Every `className` in `apps/cortex` resolves to a defined token. 243 match lines
  scanned; colour and typography are closed sets; no raw `text-<size>` anywhere.
- No `userId`/`orgId`/`instanceId` used for a data operation originates from a
  client argument, URL param, form field, or hardcoded tenant.
- No TypeScript type contradicts the live schema.
- All 18 `SECURITY DEFINER` functions: `search_path=""`, correct volatility,
  `deleted_at`-aware on BOTH `memberships` and `organizations`.
- `auth_user_can_access_role` is used in exactly one place (`role_permissions`
  SELECT) and nowhere as a role-holding authorization check.
- RLS is enabled on all 17 public tables. Exactly two have zero policies:
  `platform_admins` and `record_grants` — both intended, both with no client grants.
- The OR-bypass shape survives in no policy. The two remaining ORs (`memberships`,
  `users`) are self-row, not bypasses.

## Known debts — flagged, deliberately deferred

1. `apps/cortex/src/cortex/apps.ts` holds 19 manifests in code, while
   `app_definitions` is a table for manifests with 0 rows. Two sources of truth
   for one manifest. A manifest declares intents, and intents are functions — so
   the manifest is code. Either the table is seeded from code at startup (a
   projection), or it is dead weight. Decide in step 7.

2. Existing my-platform tables (`organizations`, `users`, `memberships`, `roles`,
   `permissions`, `role_permissions`, `membership_roles`, `messages`) still grant
   `insert`/`update`/`delete` to **both `anon` AND `authenticated`** (this entry
   previously said authenticated only — that was wrong; see Open findings B). RLS
   is the ONLY layer there — a dropped or mis-scoped policy means direct client
   writes, with no privilege boundary behind it. Step 4e fixed this for the Cortex
   tables and for all FUTURE public tables, but deliberately did not touch the
   existing ones: my-platform is a working asset with live client policies
   (`messages` has a real INSERT policy), so re-grant-auditing it is its own task
   with its own harness. Not in scope, deliberately.

3. The inventory manifest declares `permissions: ["org.read","org.write"]` and
   `roles: ["owner","manager","employee"]`. NONE exist: `public.permissions` holds
   only `members.manage` and `roles.manage` (and `roles.manage` is dead — see Open
   findings A), and roles are per-org data with no global names. It declares no
   `recordTypes`/`defaultVisibility`/`defaultGrants`, which the access model is
   built to consume. The server data-layer passes no checker, so this is latent: a
   real RBAC checker would fail every call for a reason unrelated to permissions.

4. add-member is broken in production. `origin/main` writes `membership_roles` with
   the service client; the escalation trigger now rejects it. It fails closed and
   rolls back — an outage of that one feature, not corruption. The fix is on
   `feat/cortex-shell`, pushed to origin but never merged to main.

5. Seed accounts exist on the remote with a shared known password, including the
   sole platform owner (`owner@platform.test`). The `SUPABASE_SECRET_KEY` was
   exposed in a chat and never rotated. Rotate everything at once, before a single
   real user exists.

6. `docs/Cortex-SubApp-Standard.md` §2 and §6 are dead: §2 mandates a per-tool
   `schema.sql` (deleted; the migration is the single source of truth); §6 lists
   `instance_id` as mandatory (gone; branches are child organizations). A tool
   built from the Standard today is born with both mistakes. Fix BEFORE the next
   tool — step 7 rewires the existing tool, it does not build a new one.

7. Commit `56549e1` carries the message "tighten client grants on Cortex tables
   and future public tables" but contains step 5's content
   (`20260717000003_role_escalation_guard.sql` and `verify-role-escalation.ts`).
   `19df092` carries step 5's message. The two subjects are swapped. No content was
   lost. Not fixed: the history is pushed and a rebase over 60+ commits is a bigger
   risk than a wrong label. Recorded so nobody hunts for the escalation migration
   under the wrong subject.

## Resolved debts

- inventory `apps/cortex/src/tools/inventory/logic.ts` and `Ctx.instanceId`
  (`packages/cortex-core/src/types.ts`) scoping reads by `instance_id`, a column
  that no longer exists — RESOLVED by step 7a. `instance_id` was demoted to
  audit-only: `Ctx.instanceId` is now nullable audit metadata, explicitly "never a
  scoping key", and `logic.ts` scopes by `org_id`. `logic.ts`'s own header now
  states the debt is paid, not deferred.

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
- `42501` is raised BOTH by a missing table privilege AND by an RLS policy
  violation. Asserting the code alone proves nothing; check the message.
- A NOT NULL constraint can raise where an authorization check was meant to.
  "Did it throw" measures the schema, not the guard.
- Run a new harness against the PRE-change state first. A green-only run hides
  assertions that pass in both states.
- `globals.css` makes typography and colour closed sets (`--text-*: initial`,
  `--color-*: initial`). A class outside the set does not error — it inherits.
  Eight dead type classes shipped that way.
- Grep for the SHAPE, not the name. A hardcoded identity was found by grepping
  `DEV_CTX`; an identical one in another file had no name and was missed.
  `roles.manage` survived two permission deletions for the same reason.
- The catalog is the truth; a header is a photograph. Three migration headers
  have now been found asserting things the catalog contradicts.
- Cortex's harnesses cannot reach the remote: `db-guard.ts` refuses non-local
  writes. Any claim about remote state must come from a real query, not from a
  local stack that happens to be fully migrated.
