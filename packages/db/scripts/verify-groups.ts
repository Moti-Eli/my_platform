/**
 * Verification harness for `groups` + `group_members` (migration 20260716000003).
 *
 * Builds a throwaway parent -> child org pair plus an unrelated org, seeds a
 * group at each level, and proves both halves of the design:
 *
 *   RLS (SELECT gated by auth_user_is_member_of_tree(org_id)):
 *     1. Member of the org reads its own groups                  -> visible
 *     2. Member of the PARENT reads a CHILD org's groups         -> visible (down)
 *     3. Member of the CHILD reads the PARENT's groups           -> NOT visible
 *     4. Non-member / anon                                       -> NOT visible
 *
 *   SCHEMA-LEVEL tenant safety (the load-bearing part):
 *     5. Adding a user to a group in an org they are NOT a member of is REJECTED
 *        by the composite FK. This asserts the INSERT RAISES — not merely that a
 *        later select comes back empty. The single shared org_id feeds both the
 *        group FK and the membership FK, so a mismatched pair has no valid parent
 *        row. If this ever stops raising, tenant isolation has silently moved from
 *        the schema into application code, which is exactly what it must not do.
 *     6. A group name duplicated within one org is rejected; the same name in a
 *        different org is accepted.
 *     7. SOFT-DELETING a membership leaves its group_members row INTACT (the FK
 *        fires on hard delete only, and history rides on the soft-deleted parent),
 *        but the user then fails auth_user_is_member_of_tree, so the group is no
 *        longer visible to them. Both halves are asserted.
 *
 * Connection approach mirrors verify-cortex-tables.ts: setup/teardown through the
 * service-role client, and reads through a direct Postgres connection that
 * impersonates each user exactly as the API does (`set local role authenticated`
 * + `request.jwt.claims`, which is what auth.uid() reads), so the real RLS
 * policies — and the `grant select to authenticated` — are what get exercised.
 *
 * Env: the usual Supabase vars from the root `.env`, plus SUPABASE_DB_URL (the
 * Postgres connection string). Defaults to the local `supabase start` stack.
 *
 * Run:  pnpm --filter @platform/db exec tsx scripts/verify-groups.ts
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";

import { assertLocalDatabase } from "./db-guard";

// FIRST statement: refuse to run against a non-local database. This script WRITES.
// (db-guard loads the root .env itself, so this is safe before dotenv.config below.)
assertLocalDatabase("verify-groups.ts");

const rootEnv = resolve(process.cwd(), "../../.env");
dotenv.config({ path: existsSync(rootEnv) ? rootEnv : undefined });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;
const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!URL || !SECRET) throw new Error("Missing Supabase env in root .env");

const PREFIX = "Groups Test"; // tag so cleanup is targeted
const EMAILS = {
  parent: "g-parent@groups.test",
  child: "g-child@groups.test",
  other: "g-other@groups.test",
};

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { passed++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

async function cleanup(admin: SupabaseClient): Promise<void> {
  // parent_id is ON DELETE RESTRICT, so break the links before deleting. Rows in
  // groups / group_members cascade away with their org.
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

async function makeMember(admin: SupabaseClient, orgId: string, email: string): Promise<string> {
  const created = await admin.auth.admin.createUser({ email, password: "123456", email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`create ${email}: ${created.error?.message}`);
  const userId = created.data.user.id;
  const prof = await admin
    .from("users")
    .insert({ id: userId, email: created.data.user.email ?? email, display_name: email });
  if (prof.error) throw new Error(`profile ${email}: ${prof.error.message}`);
  const mem = await admin.from("memberships").insert({ user_id: userId, organization_id: orgId });
  if (mem.error) throw new Error(`membership ${email}: ${mem.error.message}`);
  return userId;
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

type Table = "groups" | "group_members";

/**
 * Can `userId` (or anon, when null) SELECT this row through RLS? Impersonates the
 * user the way a real API request does, inside a rolled-back transaction so the
 * `set local` cannot leak into the next call.
 */
async function canRead(pg: Client, userId: string | null, table: Table, idCol: string, idVal: string): Promise<boolean> {
  await pg.query("begin");
  try {
    await pg.query("set local role authenticated");
    await pg.query("select set_config('request.jwt.claims', $1, true)", [
      userId === null ? null : JSON.stringify({ sub: userId }),
    ]);
    // `table` / `idCol` are closed unions of literals from this file — never user input.
    const res = await pg.query(`select 1 from public.${table} where ${idCol} = $1`, [idVal]);
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

    // Tree: Parent -> Child. Plus Other, an unrelated root.
    const parentOrg = await makeOrg(admin, "Parent", null);
    const childOrg = await makeOrg(admin, "Child", parentOrg);
    const otherOrg = await makeOrg(admin, "Other", null);

    const uParent = await makeMember(admin, parentOrg, EMAILS.parent);
    const uChild = await makeMember(admin, childOrg, EMAILS.child);
    const uOther = await makeMember(admin, otherOrg, EMAILS.other);

    const groupParent = await makeGroup(admin, parentOrg, "parent-org group");
    const groupChild = await makeGroup(admin, childOrg, "child-org group");

    const gm = await admin
      .from("group_members")
      .insert({ group_id: groupChild, user_id: uChild, org_id: childOrg });
    if (gm.error) throw new Error(`seed group member: ${gm.error.message}`);
    console.log(`\nSeeded "${PREFIX}": Parent -> Child (+ unrelated Other), a group per level.`);

    // --- [1] Member of the org reads its own groups ---------------------------
    console.log("\n[1] Member of the org reads its own groups");
    check("child member -> child-org group is VISIBLE", await canRead(pg, uChild, "groups", "id", groupChild));
    check("parent member -> parent-org group is VISIBLE", await canRead(pg, uParent, "groups", "id", groupParent));

    // --- [2] Inheritance flows DOWN -------------------------------------------
    console.log("\n[2] Parent-org member reads the CHILD org's groups (inherits down)");
    check("parent member -> child-org group is VISIBLE", await canRead(pg, uParent, "groups", "id", groupChild));
    check("parent member -> child-org group_members row is VISIBLE", await canRead(pg, uParent, "group_members", "group_id", groupChild));

    // --- [3] No upward leak ----------------------------------------------------
    console.log("\n[3] Child-org member must NOT read the PARENT's groups");
    check("child member -> parent-org group is NOT visible", !(await canRead(pg, uChild, "groups", "id", groupParent)));

    // --- [4] Non-member / anon -------------------------------------------------
    console.log("\n[4] Non-member (unrelated org) and anon see nothing");
    check("other member -> child-org group is NOT visible", !(await canRead(pg, uOther, "groups", "id", groupChild)));
    check("other member -> parent-org group is NOT visible", !(await canRead(pg, uOther, "groups", "id", groupParent)));
    check("other member -> child-org group_members row is NOT visible", !(await canRead(pg, uOther, "group_members", "group_id", groupChild)));
    check("anon -> child-org group is NOT visible", !(await canRead(pg, null, "groups", "id", groupChild)));
    check("anon -> child-org group_members row is NOT visible", !(await canRead(pg, null, "group_members", "group_id", groupChild)));

    // --- [5] The composite FK rejects a cross-org group membership -------------
    // Load-bearing: assert the INSERT RAISES. uOther is a member of otherOrg only,
    // so no (uOther, childOrg) membership row exists for the second composite FK
    // to land on — regardless of which org_id the caller supplies.
    console.log("\n[5] Adding a non-member of the org to its group is REJECTED by the composite FK");

    const crossOrg = await admin
      .from("group_members")
      .insert({ group_id: groupChild, user_id: uOther, org_id: childOrg });
    check(
      "other-org user into child-org group (org_id = the group's org) is REJECTED",
      !!crossOrg.error,
      crossOrg.error?.message ?? "NO ERROR — the FK did not fire"
    );

    // The other way to try it: supply the org the USER is in. Now the membership FK
    // is satisfied but the GROUP FK has no (groupChild, otherOrg) parent. Both
    // routes must fail — that is the point of the single shared org_id.
    const crossOrg2 = await admin
      .from("group_members")
      .insert({ group_id: groupChild, user_id: uOther, org_id: otherOrg });
    check(
      "other-org user into child-org group (org_id = the user's org) is REJECTED",
      !!crossOrg2.error,
      crossOrg2.error?.message ?? "NO ERROR — the FK did not fire"
    );

    // And prove it raises at the DB level too, not just through PostgREST.
    let raised = false;
    let raisedMsg = "";
    try {
      await pg.query(
        "insert into public.group_members (group_id, user_id, org_id) values ($1, $2, $3)",
        [groupChild, uOther, childOrg]
      );
    } catch (err: unknown) {
      raised = true;
      raisedMsg = err instanceof Error ? err.message : String(err);
    }
    check("the same insert RAISES on a direct SQL connection", raised, raisedMsg);
    check("...and it is a foreign-key violation", /foreign key|group_members_membership_fk/i.test(raisedMsg), raisedMsg);

    // Sanity: the legitimate pairing still works.
    const legit = await admin
      .from("group_members")
      .insert({ group_id: groupParent, user_id: uParent, org_id: parentOrg });
    check("a user in the group's OWN org is ACCEPTED", !legit.error, legit.error?.message ?? "");

    // --- [6] Group name uniqueness is per-org ----------------------------------
    console.log("\n[6] Group names are unique within an org, free across orgs");
    const dupSameOrg = await admin
      .from("groups")
      .insert({ org_id: childOrg, name: `${PREFIX} child-org group` });
    check(
      "duplicate name in the SAME org is REJECTED",
      !!dupSameOrg.error,
      dupSameOrg.error?.message ?? "NO ERROR — the unique constraint did not fire"
    );

    const dupOtherOrg = await admin
      .from("groups")
      .insert({ org_id: otherOrg, name: `${PREFIX} child-org group` });
    check("the SAME name in a DIFFERENT org is ACCEPTED", !dupOtherOrg.error, dupOtherOrg.error?.message ?? "");

    // --- [7] Soft-deleting a membership: row survives, visibility does not ------
    console.log("\n[7] Soft-deleting a membership keeps the group_members row but revokes visibility");
    check("before: child member -> child-org group is VISIBLE", await canRead(pg, uChild, "groups", "id", groupChild));

    const soft = await admin
      .from("memberships")
      .update({ deleted_at: new Date().toISOString() })
      .eq("user_id", uChild)
      .eq("organization_id", childOrg);
    if (soft.error) throw new Error(`soft-delete membership: ${soft.error.message}`);

    // Half 1 — the row is still there (checked as service_role, which bypasses RLS:
    // we are asserting the ROW's existence, not anyone's ability to read it).
    const stillThere = await admin
      .from("group_members")
      .select("group_id, user_id")
      .eq("group_id", groupChild)
      .eq("user_id", uChild);
    check(
      "the group_members row SURVIVES the soft delete (FK is on hard delete)",
      !stillThere.error && (stillThere.data?.length ?? 0) === 1,
      stillThere.error?.message ?? `${stillThere.data?.length ?? 0} row(s)`
    );

    // Half 2 — but the user now fails auth_user_is_member_of_tree.
    check(
      "after: child member -> child-org group is NOT visible (membership inactive)",
      !(await canRead(pg, uChild, "groups", "id", groupChild))
    );
    check(
      "after: child member -> its own group_members row is NOT visible",
      !(await canRead(pg, uChild, "group_members", "group_id", groupChild))
    );

    await cleanup(admin);
    console.log("\n(cleaned up test orgs, users, groups, rows)\n");
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
