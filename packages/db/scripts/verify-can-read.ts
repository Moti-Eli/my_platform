/**
 * Verification harness for `private.auth_user_can_read` and the rewired
 * `inventory_items` SELECT policy (migration 20260716000005).
 *
 * Builds HQ -> Branch B / Branch C (plus an unrelated Other), seeds items at each
 * visibility, and proves the whole read rule through the REAL policy:
 *
 *   visibility='org'        — member reads; PARENT-org member reads (down);
 *                             CHILD-org member does NOT (no upward leak);
 *                             non-member does NOT; anon does NOT.
 *   visibility='private'    — the owner reads; another member of the SAME org does
 *                             NOT (an ADMIN, to show it is not a permission
 *                             question); a parent-org member does NOT.
 *   visibility='restricted' — with NO grant, NOBODY reads, INCLUDING THE OWNER.
 *                             Deliberate: restricted means grants only, and the
 *                             tool auto-grants the owner at creation
 *                             (defaultGrants). Asserted explicitly so nobody
 *                             "fixes" it into an owner bypass later.
 *                           — user grant -> reads.
 *                           — role grant + user HOLDS the role -> reads.
 *                           — role grant + user is merely a MEMBER of the role's
 *                             org -> does NOT read. This is the
 *                             auth_user_can_access_role trap: that helper answers
 *                             org-membership, not role-holding, and using it would
 *                             turn every role grant into an org-wide grant.
 *                           — role grant on a PARENT org's role, user holds it -> reads.
 *                           — group grant + user in the group -> reads; not in -> does NOT.
 *                           — user grant but no membership anywhere in the tree ->
 *                             does NOT read (the blocking AND).
 *                           — grant for a different record_id / a different
 *                             table_name -> does NOT read.
 *
 *   THE LEAKS (the reason (b) and (c) re-check deleted_at):
 *     membership_roles and group_members cascade on HARD delete only, so they
 *     survive a soft-deleted membership. Both scenarios reproduce the migration
 *     header exactly: the user keeps a DIRECT membership in the branch, so
 *     is_member_of_tree still returns true and the blocking AND does not save us —
 *     only the deleted_at check does. Each asserts, as service_role, that the
 *     membership_roles / group_members row STILL EXISTS, so the test proves the
 *     deleted_at check is what blocks rather than a vanished row.
 *
 * Connection approach mirrors verify-record-grants.ts: setup/teardown through the
 * service-role client, reads through a direct Postgres connection impersonating
 * each user as a real API request does (`set local role authenticated` +
 * `request.jwt.claims`, which is what auth.uid() reads).
 *
 * Env: the usual Supabase vars from the root `.env`, plus SUPABASE_DB_URL (the
 * Postgres connection string). Defaults to the local `supabase start` stack.
 *
 * Run:  pnpm --filter @platform/db exec tsx scripts/verify-can-read.ts
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";

import { assertLocalDatabase } from "./db-guard";

// FIRST statement: refuse to run against a non-local database. This script WRITES.
// (db-guard loads the root .env itself, so this is safe before dotenv.config below.)
assertLocalDatabase("verify-can-read.ts");

const rootEnv = resolve(process.cwd(), "../../.env");
dotenv.config({ path: existsSync(rootEnv) ? rootEnv : undefined });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;
const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!URL || !SECRET) throw new Error("Missing Supabase env in root .env");

const PREFIX = "CanRead Test"; // tag so cleanup is targeted
const EMAILS = {
  hq: "cr-hq@canread.test",
  hqAdmin: "cr-hq-admin@canread.test",
  b: "cr-branch-b@canread.test",
  c: "cr-branch-c@canread.test",
  cAdmin: "cr-branch-c-admin@canread.test",
  other: "cr-other@canread.test",
  leakRole: "cr-leak-role@canread.test",
  leakGroup: "cr-leak-group@canread.test",
};

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { passed++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

async function cleanup(admin: SupabaseClient): Promise<void> {
  // parent_id is ON DELETE RESTRICT, so break the links before deleting. Orgs go
  // FIRST: items and grants cascade with the org, clearing the granted_by /
  // owner_id references (NO ACTION) before the users are deleted below.
  await admin.from("organizations").update({ parent_id: null }).like("name", `${PREFIX}%`);
  await admin.from("organizations").delete().like("name", `${PREFIX}%`);
  const list = await admin.auth.admin.listUsers({ perPage: 1000 });
  const emails = Object.values(EMAILS);
  for (const u of list.data.users) {
    if (u.email && emails.includes(u.email)) await admin.auth.admin.deleteUser(u.id);
  }
}

async function makeOrg(admin: SupabaseClient, name: string, parentId: string | null): Promise<string> {
  const res = await admin
    .from("organizations")
    .insert({ name: `${PREFIX} — ${name}`, parent_id: parentId })
    .select("id")
    .single();
  if (res.error || !res.data) throw new Error(`create org ${name}: ${res.error?.message}`);
  return (res.data as { id: string }).id;
}

/** Creates the auth user + profile only; memberships are added explicitly below. */
async function makeUser(admin: SupabaseClient, email: string): Promise<string> {
  const created = await admin.auth.admin.createUser({ email, password: "123456", email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`create ${email}: ${created.error?.message}`);
  const userId = created.data.user.id;
  const prof = await admin
    .from("users")
    .insert({ id: userId, email: created.data.user.email ?? email, display_name: email });
  if (prof.error) throw new Error(`profile ${email}: ${prof.error.message}`);
  return userId;
}

/** Adds a membership and returns its id (needed to attach roles). */
async function addMembership(admin: SupabaseClient, userId: string, orgId: string): Promise<string> {
  const res = await admin
    .from("memberships")
    .insert({ user_id: userId, organization_id: orgId })
    .select("id")
    .single();
  if (res.error || !res.data) throw new Error(`membership: ${res.error?.message}`);
  return (res.data as { id: string }).id;
}

async function makeRole(admin: SupabaseClient, orgId: string, name: string, isAdmin = false): Promise<string> {
  const res = await admin
    .from("roles")
    .insert({ organization_id: orgId, name: `${PREFIX} ${name}`, is_admin: isAdmin })
    .select("id")
    .single();
  if (res.error || !res.data) throw new Error(`create role ${name}: ${res.error?.message}`);
  return (res.data as { id: string }).id;
}

/**
 * Assign a role. Fine via the secret key for an org's FIRST assignment, which the
 * escalation guard (20260717000003) exempts — nobody can hold a role in an org
 * that has none. Any LATER assignment must name an actor: see holdRoleAs.
 */
async function holdRole(admin: SupabaseClient, membershipId: string, roleId: string, orgId: string): Promise<void> {
  const res = await admin
    .from("membership_roles")
    .insert({ membership_id: membershipId, role_id: roleId, organization_id: orgId });
  if (res.error) throw new Error(`hold role: ${res.error.message}`);
}

/**
 * Assign a role with the AUTHORITY OF `actingUserId` — for assignments after an
 * org's first, which the escalation guard requires an entitled actor for.
 *
 * Runs as service_role (bypassing RLS) but WITH the actor's JWT, so auth.uid()
 * resolves and the trigger judges the real actor. RLS is bypassed deliberately:
 * this file tests auth_user_can_read, not the membership_roles write policy, and
 * routing fixtures through that policy would force unrelated members.manage
 * grants onto these roles and change what is under test. The TRIGGER — the new
 * constraint — is satisfied honestly: the actor must genuinely hold an admin role
 * or the very role being conferred.
 */
async function holdRoleAs(
  pg: Client,
  actingUserId: string,
  membershipId: string,
  roleId: string,
  orgId: string
): Promise<void> {
  await pg.query("begin");
  try {
    await pg.query("set local role service_role");
    await pg.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: actingUserId })]);
    await pg.query(
      "insert into public.membership_roles (membership_id, role_id, organization_id) values ($1,$2,$3)",
      [membershipId, roleId, orgId]
    );
    await pg.query("commit");
  } catch (err) {
    await pg.query("rollback");
    throw new Error(`hold role as ${actingUserId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function makeGroup(admin: SupabaseClient, orgId: string, name: string): Promise<string> {
  const res = await admin
    .from("groups")
    .insert({ org_id: orgId, name: `${PREFIX} ${name}` })
    .select("id")
    .single();
  if (res.error || !res.data) throw new Error(`create group ${name}: ${res.error?.message}`);
  return (res.data as { id: string }).id;
}

async function addToGroup(admin: SupabaseClient, groupId: string, userId: string, orgId: string): Promise<void> {
  const res = await admin.from("group_members").insert({ group_id: groupId, user_id: userId, org_id: orgId });
  if (res.error) throw new Error(`add to group: ${res.error.message}`);
}

type Visibility = "org" | "private" | "restricted";

async function makeItem(
  admin: SupabaseClient,
  orgId: string,
  ownerId: string,
  name: string,
  visibility: Visibility
): Promise<string> {
  const res = await admin
    .from("inventory_items")
    .insert({ org_id: orgId, owner_id: ownerId, name: `${PREFIX} ${name}`, visibility })
    .select("id")
    .single();
  if (res.error || !res.data) throw new Error(`create item ${name}: ${res.error?.message}`);
  return (res.data as { id: string }).id;
}

async function grant(
  admin: SupabaseClient,
  row: Record<string, string | null>,
): Promise<void> {
  const res = await admin.from("record_grants").insert(row);
  if (res.error) throw new Error(`grant: ${res.error.message}`);
}

/**
 * Can `userId` (or anon, when null) SELECT this item through the real RLS policy?
 * Impersonates the user the way a real API request does, inside a rolled-back
 * transaction so the `set local` cannot leak into the next call.
 */
async function canRead(pg: Client, userId: string | null, itemId: string): Promise<boolean> {
  await pg.query("begin");
  try {
    await pg.query("set local role authenticated");
    await pg.query("select set_config('request.jwt.claims', $1, true)", [
      userId === null ? null : JSON.stringify({ sub: userId }),
    ]);
    const res = await pg.query("select 1 from public.inventory_items where id = $1", [itemId]);
    return (res.rowCount ?? 0) > 0;
  } finally {
    await pg.query("rollback");
  }
}

async function main(): Promise<void> {
  const admin = createClient(URL!, SECRET!, { auth: { autoRefreshToken: false, persistSession: false } });
  const isLocalDb = /@(localhost|127\.0\.0\.1)[:/]/.test(DB_URL);
  const pg = new Client({ connectionString: DB_URL, ssl: isLocalDb ? undefined : true });
  await pg.connect();

  try {
    await cleanup(admin);

    // Tree: HQ -> Branch B, HQ -> Branch C. Plus Other, an unrelated root.
    const hq = await makeOrg(admin, "HQ", null);
    const branchB = await makeOrg(admin, "Branch B", hq);
    const branchC = await makeOrg(admin, "Branch C", hq);
    const otherOrg = await makeOrg(admin, "Other", null);

    const uHq = await makeUser(admin, EMAILS.hq);
    const uHqAdmin = await makeUser(admin, EMAILS.hqAdmin);
    const uB = await makeUser(admin, EMAILS.b);
    const uC = await makeUser(admin, EMAILS.c);
    const uCAdmin = await makeUser(admin, EMAILS.cAdmin);
    const uOther = await makeUser(admin, EMAILS.other);
    const uLeakRole = await makeUser(admin, EMAILS.leakRole);
    const uLeakGroup = await makeUser(admin, EMAILS.leakGroup);

    const mHq = await addMembership(admin, uHq, hq);
    await addMembership(admin, uHqAdmin, hq);
    await addMembership(admin, uB, branchB);
    const mC = await addMembership(admin, uC, branchC);
    await addMembership(admin, uCAdmin, branchC);
    await addMembership(admin, uOther, otherOrg);

    // Roles. "Regional Manager" is an HQ role — the one the leak scenario uses.
    const roleRegionalMgr = await makeRole(admin, hq, "Regional Manager");
    const roleCLead = await makeRole(admin, branchC, "C Lead");
    await makeRole(admin, branchC, "C Admin", true);

    // uHq holds Regional Manager (HQ). uC holds C Lead (branch C).
    await holdRole(admin, mHq, roleRegionalMgr, hq);
    await holdRole(admin, mC, roleCLead, branchC);

    // uHqAdmin is a member of HQ but holds NO role — the can_access_role trap.

    const groupC = await makeGroup(admin, branchC, "C Group");
    await addToGroup(admin, groupC, uC, branchC);

    console.log(`\nSeeded "${PREFIX}": HQ -> Branch B / Branch C (+ unrelated Other).`);

    const T = "inventory_items";

    // --- [1] visibility='org' ---------------------------------------------------
    console.log("\n[1] visibility='org' — readable by the org tree, downward only");
    const orgItemC = await makeItem(admin, branchC, uC, "org item in C", "org");
    check("member of C reads C's org item", await canRead(pg, uC, orgItemC));
    check("HQ member reads C's org item (inherits DOWN)", await canRead(pg, uHq, orgItemC));

    const orgItemHq = await makeItem(admin, hq, uHq, "org item in HQ", "org");
    check("member of C does NOT read HQ's org item (no upward leak)", !(await canRead(pg, uC, orgItemHq)));
    check("member of B does NOT read C's org item (sibling)", !(await canRead(pg, uB, orgItemC)));
    check("non-member does NOT read C's org item", !(await canRead(pg, uOther, orgItemC)));
    check("anon does NOT read C's org item", !(await canRead(pg, null, orgItemC)));

    // --- [2] visibility='private' ----------------------------------------------
    console.log("\n[2] visibility='private' — the owner only, membership still required");
    const privItemC = await makeItem(admin, branchC, uC, "private item in C", "private");
    check("the OWNER reads their private item", await canRead(pg, uC, privItemC));
    check(
      "an ADMIN of the same org does NOT read it (private is not a permission question)",
      !(await canRead(pg, uCAdmin, privItemC))
    );
    check("an HQ (parent-org) member does NOT read it", !(await canRead(pg, uHq, privItemC)));

    // --- [3] visibility='restricted', no grant ---------------------------------
    console.log("\n[3] visibility='restricted' with NO grant — nobody, INCLUDING the owner");
    const restrNoGrant = await makeItem(admin, branchC, uC, "restricted no grant", "restricted");
    check(
      "the OWNER does NOT read their own ungranted restricted item",
      !(await canRead(pg, uC, restrNoGrant)),
      "restricted means grants only; the tool auto-grants the owner at creation"
    );
    check("an HQ member does NOT read it", !(await canRead(pg, uHq, restrNoGrant)));
    check("anon does NOT read it", !(await canRead(pg, null, restrNoGrant)));

    // --- [4] restricted + user grant -------------------------------------------
    console.log("\n[4] restricted + a USER grant");
    const restrUser = await makeItem(admin, branchC, uC, "restricted user grant", "restricted");
    await grant(admin, { table_name: T, record_id: restrUser, org_id: branchC, subject_user_id: uCAdmin, access: "read", granted_by: uC });
    check("the granted user reads it", await canRead(pg, uCAdmin, restrUser));
    check("an ungranted member of the same org does NOT", !(await canRead(pg, uC, restrUser)));

    // --- [5] restricted + role grant — HOLDING, not org membership --------------
    console.log("\n[5] restricted + a ROLE grant — the user must HOLD the role");
    const restrRole = await makeItem(admin, branchC, uC, "restricted role grant", "restricted");
    await grant(admin, { table_name: T, record_id: restrRole, org_id: branchC, subject_role_id: roleCLead, access: "read", granted_by: uC });
    check("a user who HOLDS the granted role reads it", await canRead(pg, uC, restrRole));

    // uCAdmin is a member of branch C (the role's org) but does not hold C Lead.
    check(
      "a MEMBER of the role's org who does NOT hold the role does NOT read it",
      !(await canRead(pg, uCAdmin, restrRole)),
      "the auth_user_can_access_role trap: that helper would have let them in"
    );

    // --- [6] restricted + a PARENT org's role ----------------------------------
    console.log("\n[6] restricted + a grant to a PARENT org's role");
    const restrParentRole = await makeItem(admin, branchC, uC, "restricted parent role grant", "restricted");
    await grant(admin, { table_name: T, record_id: restrParentRole, org_id: branchC, subject_role_id: roleRegionalMgr, access: "read", granted_by: uC });
    check("a user holding the PARENT org's role reads the child's row", await canRead(pg, uHq, restrParentRole));
    check("an HQ member NOT holding that role does NOT", !(await canRead(pg, uHqAdmin, restrParentRole)));

    // --- [7] restricted + group grant ------------------------------------------
    console.log("\n[7] restricted + a GROUP grant");
    const restrGroup = await makeItem(admin, branchC, uC, "restricted group grant", "restricted");
    await grant(admin, { table_name: T, record_id: restrGroup, org_id: branchC, subject_group_id: groupC, access: "read", granted_by: uC });
    check("a user IN the granted group reads it", await canRead(pg, uC, restrGroup));
    check("a member of the group's org NOT in the group does NOT", !(await canRead(pg, uCAdmin, restrGroup)));

    // --- [8] The blocking AND still blocks -------------------------------------
    console.log("\n[8] A grant does NOT bypass membership (the blocking AND)");
    // Grant to uOther on a C row. record_grants' trigger requires the subject to be
    // in the tree, so uOther is temporarily added to C, granted, then hard-removed —
    // leaving a grant whose subject has no membership anywhere in C's tree.
    const restrNoMember = await makeItem(admin, branchC, uC, "restricted stranger grant", "restricted");
    const tempMem = await addMembership(admin, uOther, branchC);
    await grant(admin, { table_name: T, record_id: restrNoMember, org_id: branchC, subject_user_id: uOther, access: "read", granted_by: uC });
    check("sanity: with a membership + grant, the user reads it", await canRead(pg, uOther, restrNoMember));
    const delMem = await admin.from("memberships").delete().eq("id", tempMem);
    if (delMem.error) throw new Error(`remove temp membership: ${delMem.error.message}`);
    // The grant survives (record_grants has no FK to memberships).
    const grantLives = await admin.from("record_grants").select("id").eq("record_id", restrNoMember).eq("subject_user_id", uOther);
    check("the grant row still exists after the membership is removed", (grantLives.data?.length ?? 0) === 1, `${grantLives.data?.length ?? 0}`);
    check(
      "a granted user with NO membership in the tree does NOT read it",
      !(await canRead(pg, uOther, restrNoMember)),
      "blocked by the AND, not by a missing grant"
    );

    // --- [9] Grants are scoped to their exact (table_name, record_id) -----------
    console.log("\n[9] A grant matches only its own (table_name, record_id)");
    const restrOtherRecord = await makeItem(admin, branchC, uC, "restricted other record", "restricted");
    const restrWrongTable = await makeItem(admin, branchC, uC, "restricted wrong table", "restricted");
    // uCAdmin already holds a grant on `restrUser` (section [4]) and is a member of
    // branch C, so the AND is satisfied — only the record_id differs here.
    check(
      "a grant for a DIFFERENT record_id does not read this one",
      !(await canRead(pg, uCAdmin, restrOtherRecord))
    );
    // Same record_id, different table_name.
    await grant(admin, { table_name: "app_instances", record_id: restrWrongTable, org_id: branchC, subject_user_id: uCAdmin, access: "read", granted_by: uC });
    check(
      "a grant with the same record_id but a different table_name does not read it",
      !(await canRead(pg, uCAdmin, restrWrongTable))
    );

    // --- [10] THE LEAK (role) --------------------------------------------------
    console.log("\n[10] THE LEAK (role): stale membership_roles must not grant access");
    // uLeakRole: member of HQ holding "Regional Manager", AND a direct member of C.
    const mLeakHq = await addMembership(admin, uLeakRole, hq);
    await addMembership(admin, uLeakRole, branchC);
    // NOT the first assignment in HQ, so it needs an entitled actor. uHq holds
    // Regional Manager, and a holder may confer their own role — no admin needed.
    await holdRoleAs(pg, uHq, mLeakHq, roleRegionalMgr, hq);

    const leakItem = await makeItem(admin, branchC, uC, "leak role item", "restricted");
    await grant(admin, { table_name: T, record_id: leakItem, org_id: branchC, subject_role_id: roleRegionalMgr, access: "read", granted_by: uC });
    check("before: holding the HQ role, the user reads C's restricted row", await canRead(pg, uLeakRole, leakItem));

    // They leave HQ — SOFT delete. The membership_roles row survives.
    const softHq = await admin.from("memberships").update({ deleted_at: new Date().toISOString() }).eq("id", mLeakHq);
    if (softHq.error) throw new Error(`soft-delete HQ membership: ${softHq.error.message}`);

    const mrLives = await admin.from("membership_roles").select("role_id").eq("membership_id", mLeakHq).eq("role_id", roleRegionalMgr);
    check(
      "the membership_roles row SURVIVES the soft delete (cascade is hard-delete only)",
      (mrLives.data?.length ?? 0) === 1,
      `${mrLives.data?.length ?? 0} row(s) — so deleted_at, not a vanished row, must do the blocking`
    );
    check(
      "is_member_of_tree(C) is still TRUE via the direct C membership (the AND does not save us)",
      await canRead(pg, uLeakRole, orgItemC),
      "reads C's 'org' item, proving they are still legitimately in C"
    );
    check(
      "=> after leaving HQ, the user does NOT read the HQ-role-granted row",
      !(await canRead(pg, uLeakRole, leakItem)),
      "blocked by the deleted_at check in branch (b)"
    );

    // --- [11] THE LEAK (group) -------------------------------------------------
    console.log("\n[11] THE LEAK (group): stale group_members must not grant access");
    // uLeakGroup: member of HQ and in an HQ group, AND a direct member of C.
    const mLeakGroupHq = await addMembership(admin, uLeakGroup, hq);
    await addMembership(admin, uLeakGroup, branchC);
    const groupHq = await makeGroup(admin, hq, "HQ Group");
    await addToGroup(admin, groupHq, uLeakGroup, hq);

    const leakGroupItem = await makeItem(admin, branchC, uC, "leak group item", "restricted");
    await grant(admin, { table_name: T, record_id: leakGroupItem, org_id: branchC, subject_group_id: groupHq, access: "read", granted_by: uC });
    check("before: in the HQ group, the user reads C's restricted row", await canRead(pg, uLeakGroup, leakGroupItem));

    const softGroupHq = await admin.from("memberships").update({ deleted_at: new Date().toISOString() }).eq("id", mLeakGroupHq);
    if (softGroupHq.error) throw new Error(`soft-delete HQ membership: ${softGroupHq.error.message}`);

    const gmLives = await admin.from("group_members").select("user_id").eq("group_id", groupHq).eq("user_id", uLeakGroup);
    check(
      "the group_members row SURVIVES the soft delete (cascade is hard-delete only)",
      (gmLives.data?.length ?? 0) === 1,
      `${gmLives.data?.length ?? 0} row(s) — so deleted_at, not a vanished row, must do the blocking`
    );
    check(
      "is_member_of_tree(C) is still TRUE via the direct C membership (the AND does not save us)",
      await canRead(pg, uLeakGroup, orgItemC)
    );
    check(
      "=> after leaving HQ, the user does NOT read the HQ-group-granted row",
      !(await canRead(pg, uLeakGroup, leakGroupItem)),
      "blocked by the deleted_at check in branch (c)"
    );

    await cleanup(admin);
    console.log("\n(cleaned up test orgs, users, roles, groups, items, grants)\n");
  } finally {
    await pg.end();
  }

  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("VERIFY FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
