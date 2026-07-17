# @platform/db

Database client, schema, and migrations.

## Structure

- `src/` - Supabase client factories (browser + server)
- `supabase/migrations/` - Database migrations
- `scripts/seed.ts` - Local dev seed script (test orgs + users)
- [`SCHEMA.md`](./SCHEMA.md) - Plain-English entity-relationship explanation

## Schema

The core data model is a **multi-tenant RBAC** design (organizations as
tenants; users link to orgs via memberships; roles live on the membership;
permissions are global and code-defined). See [`SCHEMA.md`](./SCHEMA.md) for the
full explanation.

**Migrations:**

- `20260605000001_core_rbac_schema.sql` — core tables, indexes, seed permissions.
- `20260605000002_enable_rls_tenant_isolation.sql` — RLS + org-membership
  tenant-isolation policies (SELECT only).
- `20260608000001_allow_public_read_permissions.sql` — makes the global
  permission catalog anon-readable.
- `20260608000002_grant_service_role_privileges.sql` — grants `service_role`
  full DML on the public schema (used by trusted server-side code / the seed).
- `20260608000003_membership_roles_write_policy.sql` — first permission-checked
  write path: users with `members.manage` may assign/unassign roles on a
  membership in their own org (`auth_user_has_permission` helper).
- `20260609000001_platform_admins_super_admin.sql` — **platform-owner (super
  admin)** layer above org admins: a sealed `platform_admins` allowlist (RLS
  deny-all + `REVOKE ALL`, writable only server-side via `service_role`) and the
  `auth_user_is_platform_owner()` RPC. No cross-org RLS is added — super-admin
  power is server-side only. See [`SCHEMA.md`](./SCHEMA.md).
- `20260609000002_messages_org_chat.sql` — **internal org chat** `messages`
  table (org-scoped) with RLS: members-only SELECT, and INSERT requiring org
  membership **and** `sender_id = auth.uid()` (anti-forgery). Immutable for now
  (no update/delete). PART 1 of the chat feature (data + RLS only).
- `20260609000003_messages_realtime_publication.sql` — adds `messages` to the
  `supabase_realtime` publication so clients can subscribe to live INSERTs
  (Postgres Changes). RLS still gates delivery, so the socket respects org
  isolation. PART 2 of the chat feature.
- `20260609000004_tighten_client_role_grants.sql` — defense in depth: revokes
  `TRUNCATE`/`TRIGGER`/`REFERENCES` from `anon`/`authenticated` on every current
  public table, and adjusts the `postgres`-owned default privileges so future
  tables don't re-grant them. `TRUNCATE` is destructive and **not** gated by RLS,
  hence the strip. SELECT/INSERT and every `service_role` grant are untouched.
- `20260609000005_last_admin_db_guard.sql` — **DB-level last-admin guard**: a
  DEFERRABLE INITIALLY DEFERRED constraint trigger on `membership_roles`
  (`private.enforce_org_keeps_admin`, SECURITY DEFINER) rejecting any operation
  that would leave an existing org (that still has members) with zero `is_admin`
  assignments. Judged at COMMIT on the transaction's FINAL state, so cascade
  deletes and add-then-drop admin swaps still pass. Holds even against
  `service_role`, so it can't be bypassed by a direct privileged call.
- `20260609000006_membership_roles_covering_indexes.sql` — covering indexes for
  the two composite FKs on `membership_roles` — `(membership_id,
  organization_id)` and `(role_id, organization_id)` — so deleting a membership
  or role no longer seq-scans the table. Drops the now-redundant `role_id`-only
  index (the new composite leads with it); keeps `organization_id` (it backs the
  org-scoped RLS reads and the last-admin guard's count).
- `20260609000007_messages_sender_id_index.sql` — covering index on
  `messages.sender_id` for its FK to `users.id`, so deleting a user no longer
  seq-scans `messages`.
- `20260610000001_soft_deletes.sql` — **soft deletes** for `organizations`,
  `memberships`, `messages`: a nullable `deleted_at` (NULL = active), a new
  `private.org_is_active` helper, and the membership helpers
  (`auth_user_is_member_of`, `auth_user_shares_org_with`,
  `auth_user_can_access_role`, `auth_user_has_permission`) become
  `deleted_at`-aware — a membership counts only if it AND its org are active, so
  soft-deleting a PARENT cascades the hidden state to its children for free. Adds
  `deleted_at is null` to the SELECT policies + partial indexes for the
  active-only reads. Only ever NARROWS visibility, so tenant isolation is
  unchanged; soft-delete writes go through `service_role`. Hard-delete FKs are
  kept for genuine purges; `users` is deferred.
- `20260610000002_input_length_limits.sql` — CHECK constraints bounding
  user-supplied text at the DB layer (security review M1/L2): `messages.content`
  ≤4000 chars, `organizations.name` / `roles.name` / `users.display_name` ≤200,
  each also requiring at least one non-whitespace char (so empty/whitespace-only
  values are rejected). Enforced in the DB because the chat composer posts
  straight to PostgREST with no server action to validate in — so the bound holds
  for every caller, including the service-role key. Idempotent.
- `20260610000003_remove_unused_users_invite.sql` — deletes the `users.invite`
  permission (security review L3). It was seeded and granted to every Member role
  but checked NOWHERE; `members.manage` is the real gate for member management,
  including the privileged add-user path. Wiring it instead would have let
  ordinary members reach that path, so it is removed. Cascades its
  `role_permissions` rows away; forward-only (the original seeding migration is
  left intact).
- `20260714000001_cortex_shell_tables.sql` — **Cortex super-app core** shell
  tables (additive): `app_definitions` (global tool catalog, authenticated-
  readable), `app_instances` (owned/placed instances; polymorphic `owner_id`,
  nullable `org_id`), `events` (event-bus log), `ai_log` (data-layer audit
  trail). RLS follows the Cortex Standard §6 SELECT pattern (`owner_id =
  auth.uid()` OR member of `org_id`, via `auth_user_is_member_of`); shell writes
  go through `service_role` (no client write policies yet). See `SCHEMA.md`
  "Cortex Shell Tables" and `packages/cortex-core`.
  **`app_instances` and its policy were superseded by `20260716000002`**
  (`app_definitions`, `events`, `ai_log` stand as described).
- `20260714000002_inventory_items.sql` — **Cortex Inventory tool** table
  (additive): the first tool table, with the three mandatory fields
  (`instance_id`, `owner_id`, `org_id`), indexes on the isolation fields, and RLS
  (SELECT via `auth_user_is_member_of`; writes `service_role`-only until Cortex
  auth lands — `memberships` has no `role` column for §6's owner/manager check).
  See ARCHITECTURE.md #30. **Superseded by `20260716000002`**, which drops and
  rebuilds this table org-scoped; the hand-maintained `schema.sql` duplicate it
  mirrored is deleted — the migration is the single source of truth.
- `20260716000001_organization_hierarchy.sql` — **organization hierarchy**
  (additive): `organizations.parent_id` (nullable = root; `on delete restrict`,
  so children must be re-parented/deleted first) + a no-cycle `BEFORE
  INSERT/UPDATE` trigger, and the tree-aware `auth_user_is_member_of_tree`
  helper — membership inherits DOWNWARD only (a parent's member reaches
  descendants; a child's member never reaches ancestors), active-only walk,
  depth-capped at 32. No policy rewiring: every existing policy still calls the
  flat `auth_user_is_member_of`, so visibility is unchanged.
- `20260716000002_cortex_org_tree_model.sql` — **Cortex reshaped onto the org
  tree** (DESTRUCTIVE; both tables were verified EMPTY first). Drops and rebuilds
  `app_instances` (polymorphic `owner_type`/`owner_id` gone — `owner_id` is now a
  real FK to `users`; `org_id` is NOT NULL, since every user has a personal org)
  and `inventory_items` (`instance_id` gone — tabs/branches are CHILD ORGS, not
  instances; adds `visibility in ('private','org','restricted')`). Re-adds the
  `events.emitted_by_instance` / `ai_log.target_instance_id` FKs that the cascade
  orphaned, same `ON DELETE SET NULL`; those audit columns survive. RLS SELECT is
  rebuilt on `auth_user_is_member_of_tree(org_id)` — the old `owner_id =
  auth.uid() OR is_member(org)` is deliberately NOT reproduced (that OR let a
  departed member keep reading; membership is now a blocking AND). Inventory
  admits only `visibility = 'org'` — 'private'/'restricted' are unreadable until
  `record_grants` lands (fail closed). Writes stay `service_role`-only; `events`
  and `ai_log` policies untouched.
- `20260716000003_groups.sql` — **groups + group_members** (additive Cortex shell
  tables, so `org_id`, not `organization_id`). `groups` is a named collection of
  people in ONE org (unique name per org; carries NO permissions — an addressing
  primitive, not a role). `group_members` is tenant-safe **by schema**: it carries
  a single `org_id` feeding TWO composite FKs — `(group_id, org_id)` →
  `groups (id, org_id)` and `(user_id, org_id)` → `memberships (user_id,
  organization_id)` — so a user can only join a group in an org they are actually
  a member of; a mismatched pair has no valid parent row and the insert fails.
  Same mechanism as `membership_roles` (20260605000001). Both tables are
  hard-delete (no `deleted_at`) per the roles/join-table precedent — history rides
  on the soft-deleted parent — so soft-deleting a membership KEEPS its
  `group_members` row while `auth_user_is_member_of_tree` immediately revokes the
  user's visibility. RLS SELECT via `auth_user_is_member_of_tree(org_id)`
  (inherits DOWN the tree only); writes stay unpolicied and therefore denied —
  group management goes through the shell as `service_role`. Verified by
  `scripts/verify-groups.ts`.
- `20260716000004_record_grants.sql` — **per-record access grants** (flat ReBAC;
  additive, data-only). `record_grants` stores who may `read`/`write`/`grant` a
  given row. The SUBJECT side is three real FKs (`subject_user_id` /
  `subject_role_id` / `subject_group_id`) with a CHECK that **exactly one** is set
  (a sum of non-null flags = 1), *not* a polymorphic `(subject_type, subject_id)`
  pair — real FKs mean deleting a role/group cascades its grants away instead of
  leaving a security table full of pointers to the dead. The OBJECT side
  (`table_name`, `record_id`) stays polymorphic — inherent to flat ReBAC, since a
  FK must name one table; a stale grant is inert because every read path ANDs
  org-tree membership first. `org_id` is DENORMALIZED from the granted row
  (required: `table_name` is dynamic, so nothing resolves the row's org without
  dynamic SQL) and is kept honest by a later trigger making a tool row's `org_id`
  immutable. `granted_by` mirrors `inventory_items.owner_id`'s NO ACTION on
  delete. Uniqueness is **three PARTIAL unique indexes**, one per subject kind —
  a plain multi-column unique would never fire, since Postgres treats NULLs as
  distinct (and `NULLS NOT DISTINCT` is deliberately avoided as too subtle);
  changing a level is an UPDATE, not a second row. **SEALED**: RLS enabled with
  NO policies and nothing granted to `anon`/`authenticated` (plus `revoke all`,
  as on `platform_admins`) — a grant row leaks that a record exists and who can
  see it, so reads happen only inside SECURITY DEFINER helpers and via
  `service_role`. A `BEFORE INSERT/UPDATE` trigger
  (`private.enforce_record_grant_subject_in_tree`) requires the subject to belong
  to the record's org **or an ANCESTOR** (active-only walk, depth-capped at 32,
  mirroring `auth_user_is_member_of_tree`): granting to a PARENT org's role is the
  central case the tree exists for, so equality would be wrong; a CHILD org's role
  is rejected (no upward leak), and **membership must precede the grant** (a
  soft-deleted membership does not count). Does NOT rewire the `inventory_items`
  policy — it stays fail-closed until a separate migration teaches it to consult
  these grants. Verified by `scripts/verify-record-grants.ts`.
- `20260716000005_auth_user_can_read.sql` — **the row-level read rule**, and the
  `inventory_items` policy rewire that puts it in the path (finally opening the
  `private`/`restricted` rows `20260716000002` left fail-closed). Adds
  `private.auth_user_can_read(table_name, record_id, org_id, owner_id,
  visibility)` — row fields arrive as PARAMETERS (the policy already has the row;
  a generic re-lookup would need dynamic SQL). Shape:
  `is_member_of_tree(org_id)` as a **blocking AND**, then `visibility = 'org'` OR
  (`'private'` AND owner) OR (`'restricted'` AND a `record_grants` match: granted
  user / **held** role / joined group). Only the restricted branch touches
  `record_grants`. The old `owner_id = auth.uid() OR is_member(org)` shape is
  never reproduced — membership blocks first, always. The role and group branches
  re-check that the backing membership AND its org are ACTIVE: this is
  LOAD-BEARING, not defensive noise, because `membership_roles`/`group_members`
  cascade on HARD delete only and survive a soft-deleted membership — a user who
  leaves HQ but keeps a direct branch membership would otherwise still read rows
  granted to their old HQ role (the AND does not save you; they are legitimately
  still in the branch). Deliberately does NOT use
  `private.auth_user_can_access_role` — that answers "is the user in the role's
  ORG", not "does the user HOLD the role", and would turn every role grant into an
  org-wide grant. `inventory_items`' SELECT policy is replaced (not amended) with
  "read inventory the user is entitled to"; the old name claimed "org-visible",
  which stops being true. `app_instances` is untouched (no `visibility` column);
  no write policy is added. Verified by `scripts/verify-can-read.ts` (33
  assertions, incl. both staleness leaks), proven non-vacuous by mutation.
- `20260716000006_auth_user_can_write_grant.sql` — the other two verbs:
  `private.auth_user_can_write` and `private.auth_user_can_grant`. **Wires
  NOTHING** — both are created unused (as `auth_user_is_member_of_tree` was in
  `20260716000001`); no policy is added or changed, and no table is touched.
  `shell.grant_access` consumes `can_grant` in a later step. Same five-parameter
  signature as `can_read`, and the same three-branch grant matcher including the
  load-bearing `deleted_at` checks on the role/group branches. Access is
  HIERARCHICAL (`grant` > `write` > `read`): `can_write` accepts
  `access IN ('write','grant')` — a `read` grant confers no write — while
  `can_grant` accepts `access = 'grant'` ONLY, since changing a row and widening
  who can see it are different powers. `can_write` mirrors `can_read`'s shape;
  **`can_grant` is deliberately NARROWER** — `is_member_of_tree AND visibility =
  'restricted' AND a 'grant'-level grant`, with **no `org` branch** (the tree
  already reads the row, so a grant would only mint no-op rows in a security
  table) and **no owner branch** (a grant on a `private` row could never fire —
  `can_read`'s private branch has no grant branch beside it — and `visibility`
  becomes immutable later, so a private row cannot be upgraded to shareable; a row
  meant to be shared is born `restricted`). The first grant on a restricted row is
  seeded by the shell as `service_role` from the manifest's `defaultGrants`, so
  `can_grant` governs humans re-granting, not creation. `can_write` answers WHICH
  ROW only — whether the user may write that KIND of thing is
  `auth_user_has_permission`, composed with AND at the call site (the line
  `20260605000002` draws). Verified by `scripts/verify-can-write-grant.ts` (38
  assertions), proven non-vacuous by mutation.
- `20260716000007_tool_row_immutability.sql` — **tool rows' `visibility` /
  `org_id` / `owner_id` are IMMUTABLE**. One reusable `BEFORE UPDATE` trigger
  function, `private.enforce_tool_row_immutability` — table-agnostic (reads
  NEW/OLD), attached per tool table; future tool tables attach the SAME function
  rather than copying it. Attached to `inventory_items`, the only tool table today;
  deliberately NOT to `app_instances` (a shell table — no `visibility` column, and
  `record_grants` never points at it). Comparisons use `IS DISTINCT FROM`, so an
  ORM re-sending every column at its current value still succeeds — only an actual
  CHANGE raises — and each column raises its own message naming the attempted
  transition. This keeps two earlier promises: `record_grants`' denormalized
  `org_id` is only honest if the row cannot move (it can't look the row up —
  `table_name` is dynamic), and `auth_user_can_grant`'s missing private branch is
  only safe if a `private` row cannot be re-labelled `restricted` to share it.
  **No role exemption — the trigger fires for `service_role` too** (`service_role`
  bypasses RLS, not triggers): the shell is the only write path, so exempting it
  would exempt the entire threat model — the same reasoning as the last-admin guard
  (`20260609000005`). The escape hatch is delete + re-insert, which is correct
  rather than a workaround: grants reference org-scoped roles/groups, so a row
  changing org must have its grants rebuilt from the manifest's `defaultGrants`,
  not carried across. Verified by `scripts/verify-row-immutability.ts` (26
  assertions), proven non-vacuous by mutation.
- `20260716000008_shell_grant_access.sql` — **the door onto `record_grants`**:
  `shell.grant_access` / `shell.revoke_access` (new `shell` schema; USAGE +
  EXECUTE to `authenticated`/`service_role`, but **not** added to PostgREST's
  exposed schemas — where the door is mounted is a step-7 decision). Both are
  SECURITY DEFINER (they must be, to write a sealed table) and both re-check
  `private.auth_user_can_grant` for the CALLER on every path: `auth.uid()` resolves
  from the request JWT even inside SECURITY DEFINER, so a caller with no JWT — **a
  direct `service_role` connection included** — gets `auth.uid() = null` and is
  refused. Revoking requires `can_grant` exactly as granting does (widening and
  withdrawing access are the same power); revoking something absent returns `false`
  rather than raising, so cleanup stays idempotent. `p_table_name` is validated **by
  SHAPE, not an allowlist** — a base table in `public` with `org_id`, `owner_id`
  and `visibility`, read from `pg_catalog` (not `information_schema`, whose answers
  depend on the caller's privileges). An allowlist would be a second source of truth
  to update alongside every tool migration; instead `app_instances` and
  `record_grants` are excluded automatically (no `visibility`), anything outside
  `public` by schema, and a new tool table becomes grantable by being shaped like
  one. The row's org/owner/visibility are read with `format(..., %I)` dynamic SQL —
  safe because the identifier is both quoted AND already proven to name a real
  shaped table; `record_id` is a bind parameter, and injection strings die at the
  shape check before any dynamic SQL runs. The grant's `org_id` is always the ROW's
  org, **never a parameter** (a caller-stated org would let the denormalized copy
  lie); `granted_by` is the caller. Upserts branch one arm per subject because the
  unique indexes are PARTIAL — an arbiter must restate the index's WHERE predicate,
  so no single generic ON CONFLICT exists — and re-granting UPDATES the level rather
  than adding a row. The door does NOT bypass the subject-in-tree trigger.
  `service_role` KEEPS its direct DML from `20260608000002`, deliberately: the first
  grant on a restricted row is chicken-and-egg (`can_grant` needs an existing
  `grant`-level grant), so the shell seeds it from the manifest's `defaultGrants` at
  creation; revoking that DML would break the bootstrap or force a can_grant-skipping
  back door. The door protects TOOLS and CLIENTS, which cannot reach `record_grants`
  at all. Verified by `scripts/verify-grant-access.ts` (45 assertions), proven
  non-vacuous by mutation.
- `20260717000001_tighten_cortex_client_grants.sql` — **client-role grants on the
  Cortex tables and on FUTURE public tables** (defense in depth). Probed first, not
  assumed: `anon` and `authenticated` each held `INSERT/UPDATE/DELETE/SELECT` on
  `inventory_items` / `app_instances` / `groups` / `group_members` (inherited from
  the postgres-owned default privileges), so RLS was the ONLY layer stopping a
  publishable key from writing them — every policy on those tables is SELECT-only,
  which is why nothing was visibly broken. Revokes `insert, update, delete` from
  both roles on those four, and `all` from `anon` (anon has no business reading
  Cortex data — every policy is `to authenticated`, so anon already got zero rows;
  now it gets a permission error, which is a privilege boundary rather than a side
  effect of policy scoping). `authenticated` KEEPS `SELECT` — the policies depend on
  it. Also revokes `insert, update, delete` from the **postgres-owned default
  privileges** for future tables, following `20260609000004`'s validated reasoning
  (our migrations run AS postgres; the `supabase_admin`-owned default is left
  untouched and unused, since our tables are postgres-owned) — a per-table-only fix
  would mean every future tool migration must REMEMBER to revoke, which is a second
  source of truth. SELECT and MAINTAIN are deliberately left in the default (wider
  blast radius than this migration should carry). `record_grants` is NOT touched —
  it was already fully sealed by `20260716000004` (verified). `service_role` is NOT
  touched anywhere: it is the only write path. **Scope boundary**: this changes NO
  existing my-platform table's grants — they keep client writes gated by RLS alone,
  a known deferred debt (see the roadmap). Verified by
  `scripts/verify-client-grants.ts` (38 assertions, incl. a default-privileges proof
  against a throwaway table), shown non-vacuous by failing 14 assertions against the
  pre-migration state. Updated for `20260717000005`: it now asserts `inventory_items`
  as the RLS-gated client write path (authenticated holds INSERT+UPDATE, not DELETE;
  writes gated by policy, not privilege) while the other three Cortex tables stay
  write-sealed.
- `20260717000002_shell_audit_org_scope.sql` — **org-scopes the shell audit tables
  and fixes a LIVE bug** (both verified EMPTY first: `events` = 0, `ai_log` = 0).
  `events.org_id` becomes NOT NULL (the old comment "NULL for a personal-context
  event" was false — every user has a personal org, so there is no org-less
  context); `ai_log` gains `org_id` NOT NULL + an index, because an audit trail only
  its own subject can read is not an audit trail. **The bug**: `events`' policy was
  still `user_id = auth.uid() OR (org_id is not null AND is_member_of(org_id))` —
  the same OR bypass `20260716000002` removed from `inventory_items` /
  `app_instances`, which explicitly left `events`/`ai_log` untouched and was never
  followed up. The left branch never re-checks membership, so a departed user kept
  reading events they emitted — `payload` and all. Replaced with
  `private.auth_user_is_member_of_tree(org_id)`, no OR: membership is a blocking
  condition, and any member of the org (or an ancestor) reads its events, which
  preserves the original intent — events were never private to their emitter. Note
  the two halves interlock: with a nullable `org_id` the OR was the only thing making
  org-less rows visible, so NOT NULL is what lets it go without stranding rows.
  `ai_log`'s policy becomes `is_member_of_tree(org_id) AND user_id = auth.uid()` —
  a deliberate **strict prefix** of the final rule, which later widens to
  `... AND (user_id = auth.uid() OR auth_user_has_permission(org_id, 'audit.view'))`
  once step 5 settles the permission vocabulary; seeding `audit.view` now would
  create vocabulary before the split/delete migration finalizes it. Consequence
  today: leaving an org costs you even your OWN audit rows for it — the org keeps
  the record, the person loses access. Also applies `20260717000001`'s grant
  tightening to these two tables, which it did not cover (verified: both still gave
  anon AND authenticated `DELETE,INSERT,SELECT,UPDATE`). `app_definitions` and
  `app_instances` untouched. Verified by `scripts/verify-shell-audit.ts` (27
  assertions), proven non-vacuous by reinstating the old policy.
- `20260717000003_role_escalation_guard.sql` — **forbids role-assignment
  escalation**, paying off the debt `20260608000003` named in its own header
  ("forbid self-escalation"). That migration gated `membership_roles` writes on
  `members.manage` and noted it was safe only because that permission was held by
  admin roles alone — but roles are org-owned DATA, so the assumption expires the
  day an admin grants `members.manage` to a non-admin role, with no schema change
  to review. Adds `private.auth_user_may_assign_role(org_id, role_id)`, mirroring
  `auth_user_has_permission`'s exact shape (same joins, same active-only guards on
  membership AND org) with one changed predicate: `r.is_admin OR r.id = p_role_id`
  — you may confer only a role you already hold, unless you are an admin (who may
  confer anything, else nobody could staff a new role). `auth.uid()` null ⇒ false,
  by construction rather than special case. Enforced by a BEFORE ROW trigger, not
  a policy: the rule relates the ACTOR's roles to the row's role, the DELETE half
  must inspect OLD, and **a trigger fires for `service_role`, which RLS does not**.
  That last point is the design: a no-JWT privileged caller is rejected, so the
  dev seed, `add-member`, and the harness fixtures now assign roles AS a real
  actor instead of through a secret-key back door — the fixtures exercise the
  production path, so if assignment breaks, they break first. Two exemptions, both
  structural: (1) **bootstrap** — an org with ZERO role rows accepts its first
  assignment, because nobody can hold a role in an org that has none (step 6's
  personal-org-on-signup is otherwise unbuildable); one-shot, since re-arming it
  means deleting rows this same trigger guards. (2) **referential cleanup** — a
  DELETE whose parent membership or role is already gone is a CASCADE, not a
  revocation; without it `delete from organizations` and user deletion would be
  impossible for anyone (verified: the org survived). That is the exact trap
  `20260609000005`'s header warns of, and this reuses its "parent gone ⇒ moot"
  construction; BOTH parents are checked because the cascade paths differ (org ⇒
  both, user ⇒ memberships only, role ⇒ roles only — probed, not assumed). Honest
  limit, stated in the header: the service key CAN re-arm the bootstrap by
  emptying an org's memberships — acceptable only because such a caller already
  owns the database. **Deliberately does NOT split `members.manage` into
  `members.manage_admins`** (the roadmap's step-5 proposal): with this trigger
  such a permission could never fire — assigning an is_admin role already requires
  holding one, and any is_admin holder implicitly has every permission via
  `auth_user_has_permission`'s `r.is_admin` branch — so it would be
  granted-but-unenforceable, exactly the defect this migration deletes
  `users.view` for. Also **deletes `users.view`**, following `20260610000003`
  exactly: granted to every Member role, checked nowhere (every registry's
  `requiredPermission` is null or `members.manage`). Consequence, and correct: the
  seeded Member role is left with ZERO permissions — membership is the marker,
  permissions are for actions. Forward-only; `20260605000001`'s seed is untouched.
  Verified by `scripts/verify-role-escalation.ts` (29 assertions), proven
  non-vacuous by mutating the final predicate to `true` (7 assertions fail —
  every non-admin escalation; the admin, bootstrap-without-JWT, soft-delete, and
  `users.view` assertions correctly do not move, as they turn on other clauses).

## Local-only guard (every script that writes)

**Scripts under `scripts/` refuse to run against a non-local database.**

This is not a precaution in the abstract — it is a fix. Harness fixtures were once
written to the **LIVE remote project**: the root `.env` points
`NEXT_PUBLIC_SUPABASE_URL` at the hosted project while `SUPABASE_DB_URL` is unset
and falls back to the local stack, so a run was split-brained — supabase-js
fixtures went to remote while the `pg` assertions ran against local. Test
organizations and users were created on the real project and removed by hand. The
mitigation at the time was a per-run env override, which protects only whoever
remembers to type it. `scripts/db-guard.ts` disarms the trap for everyone.
`seed.ts` is the worst case: it creates auth users with a known shared password.

`assertLocalDatabase()` is the **first statement** of every writing script. It
resolves every URL the script will use — `NEXT_PUBLIC_SUPABASE_URL` and
`SUPABASE_DB_URL` (which defaults to the local literal the scripts already
shared) — and refuses unless **all** of them are local, naming the offending
variable and the host it resolved to. It **fails closed**: an unset or blank
variable is a refusal, not a pass, and a URL it cannot parse is treated as remote.

Hosts are **parsed, never substring-matched** — `https://localhost.evil.supabase.co`
contains "localhost" and is correctly refused. That is the load-bearing property,
and `scripts/verify-db-guard.ts` exists mostly to hold it in place.

It **refuses; it does not redirect.** Point your environment at the local stack
and re-run — the guard will never silently send writes somewhere you did not ask
for. Nothing here reads or writes any env file, and no `.env.local` / `.env.test`
is involved.

Not guarded: `verify-observability.ts`, which touches no database at all (it is a
unit test of the logging package).

### Escape hatch

```bash
ALLOW_REMOTE_DB_WRITES=i-understand   # EXACT string; 1 / true / yes all still refuse
```

An exact-match string, deliberately not a truthy check — so it cannot be tripped
by reflex or by a CI system that helpfully sets flags to `1`. **Nothing in this
repo sets it**; it exists so a human can type it, once, on purpose. When it is
used the script warns loudly that it is writing to a non-local database.

## Usage

```typescript
import { createBrowserDbClient, createServerDbClient } from "@platform/db";
```

These are framework-agnostic factories over `@supabase/ssr`. Apps supply the
URL, key, and (server-side) a cookie adapter — see `apps/web/src/lib/supabase/`.

## Seeding test data (development only)

`scripts/seed.ts` populates the linked Supabase project with fictional data so
you can develop and demo tenant isolation by logging in as different org admins.

It seeds **2 organizations** (Organization A, Organization B), each with **5
users** (2 admins + 3 members), an **Admin** role (`is_admin = true`) and a
**Member** role (holding **zero** permissions — `users.view` was deleted in
`20260717000003`; membership is the marker, permissions are for actions), plus real Supabase
**auth users** + their `public.users` profiles, memberships, and role
assignments. It also seeds one **platform owner** (super admin),
`owner@platform.test`, flagged in `platform_admins` and belonging to **no**
organization.

```bash
pnpm seed                       # from the repo root
# or
pnpm --filter @platform/db seed
```

Requirements & safety:

- Reads `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` from the root
  `.env`. The **secret (service-role) key** is required because the script
  bypasses RLS to insert data. It is **server-side only** and never used by the
  web app.
- **Idempotent**: clears previously-seeded data first (seed orgs by name plus
  auth users on the seed domains `@organizationa.com`/`@organizationb.com` and
  the legacy `.test` suffix), so it is safe to re-run.
- Prints the **target project URL** before running and refuses to run with
  `NODE_ENV=production` (override with `SEED_FORCE=1`).
- Prints a **login credentials table** at the end.

All test users share the password **`123456`**. The emails use `.com` but are
fake/non-deliverable (we use email+password, not magic links).

| Email | Password | Organization | Role |
|---|---|---|---|
| admin1@organizationA.com | 123456 | Organization A | Admin |
| admin2@organizationA.com | 123456 | Organization A | Admin |
| user1@organizationA.com | 123456 | Organization A | Member |
| user2@organizationA.com | 123456 | Organization A | Member |
| user3@organizationA.com | 123456 | Organization A | Member |
| admin1@organizationB.com | 123456 | Organization B | Admin |
| admin2@organizationB.com | 123456 | Organization B | Admin |
| user1@organizationB.com | 123456 | Organization B | Member |
| user2@organizationB.com | 123456 | Organization B | Member |
| user3@organizationB.com | 123456 | Organization B | Member |
| owner@platform.test | 123456 | — (no org) | Platform Owner (super admin) |
