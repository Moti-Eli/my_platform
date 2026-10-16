/**
 * Verification harness for the organization hierarchy + the tree-aware membership
 * helper `private.auth_user_is_member_of_tree` (migration 20260716000001).
 *
 * Builds a throwaway 3-level tree (grand -> parent -> child) plus an unrelated
 * org, then proves the helper's contract — above all the DIRECTION of inheritance:
 *   1. Member of the org itself                    -> true
 *   2. Member of the PARENT, querying the CHILD    -> true  (inherits DOWN)
 *   3. Member of the CHILD, querying the PARENT    -> FALSE (no upward leak)
 *   4. Member of the GRANDPARENT, querying the GRANDCHILD -> true (multi-level)
 *   5. Non-member (member of an unrelated org)     -> false
 *   6. Soft-deleted membership                     -> false
 *   7. Anonymous (auth.uid() is null)              -> false
 *   8. Cycle attempt (parent := a descendant)      -> rejected by the DB trigger
 *
 * WHY THIS ONE NEEDS A DIRECT DB CONNECTION (unlike the other harnesses):
 * the helper lives in the `private` schema, which PostgREST does not expose, and
 * this migration deliberately wires it into NO policy yet — so there is no REST
 * surface to reach it through. We therefore connect straight to Postgres and
 * impersonate each user the way the API does: `set local role authenticated` +
 * `request.jwt.claims`, which is exactly what `auth.uid()` reads. Setup/teardown
 * still go through the service-role client like every other harness.
 *
 * Env: the usual Supabase vars from the root `.env`, plus SUPABASE_DB_URL (the
 * Postgres connection string). Defaults to the local `supabase start` stack.
 *
 * Run:  pnpm --filter @platform/db exec tsx scripts/verify-org-tree.ts
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";

import { assertLocalDatabase } from "./db-guard";

// FIRST statement: refuse to run against a non-local database. This script WRITES.
// (db-guard loads the root .env itself, so this is safe before dotenv.config below.)
assertLocalDatabase("verify-org-tree.ts");

const rootEnv = resolve(process.cwd(), "../../.env");
dotenv.config({ path: existsSync(rootEnv) ? rootEnv : undefined });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;
const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!URL || !SECRET) throw new Error("Missing Supabase env in root .env");

const PREFIX = "OrgTree Test"; // tag so cleanup is targeted
const EMAILS = {
  grand: "ot-grand@orgtree.test",
  parent: "ot-parent@orgtree.test",
  child: "ot-child@orgtree.test",
  other: "ot-other@orgtree.test",
  removed: "ot-removed@orgtree.test",
};

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { passed++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

async function cleanup(admin: SupabaseClient): Promise<void> {
  // parent_id is ON DELETE RESTRICT, so break the links before deleting.
  await admin.from("organizations").update({ parent_id: null }).like("name", `${PREFIX}%`);
  await admin.from("organizations").delete().like("name", `${PREFIX}%`);
  const list = await admin.auth.admin.listUsers({ perPage: 1000 });
  const emails = Object.values(EMAILS);
  for (const u of list.data.users) {
    if (u.email && emails.includes(u.email)) await admin.auth.admin.deleteUser(u.id);
  }
}

async function makeOrg(
  admin: SupabaseClient,
  name: string,
  parentId: string | null
): Promise<string> {
  const res = await admin
    .from("organizations")
    .insert({ name: `${PREFIX} — ${name}`, parent_id: parentId })
    .select("id")
    .single();
  if (res.error || !res.data) throw new Error(`create org ${name}: ${res.error?.message}`);
  return (res.data as { id: string }).id;
}

async function makeMember(
  admin: SupabaseClient,
  orgId: string,
  email: string
): Promise<{ userId: string; membershipId: string }> {
  const created = await admin.auth.admin.createUser({ email, password: "123456", email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`create ${email}: ${created.error?.message}`);
  const userId = created.data.user.id;
  const prof = await admin
    .from("users")
    .insert({ id: userId, email: created.data.user.email ?? email, display_name: email });
  if (prof.error) throw new Error(`profile ${email}: ${prof.error.message}`);
  const mem = await admin
    .from("memberships")
    .insert({ user_id: userId, organization_id: orgId })
    .select("id")
    .single();
  if (mem.error || !mem.data) throw new Error(`membership ${email}: ${mem.error?.message}`);
  return { userId, membershipId: (mem.data as { id: string }).id };
}

/**
 * Call the helper AS `userId` (or as anon when userId is null), the way a real
 * API request does: role `authenticated` + a `request.jwt.claims` GUC carrying
 * `sub`, which is what auth.uid() reads. Wrapped in a rolled-back transaction so
 * `set local` cannot leak into the next call.
 */
async function isMemberOfTree(pg: Client, userId: string | null, orgId: string): Promise<boolean> {
  await pg.query("begin");
  try {
    await pg.query("set local role authenticated");
    await pg.query("select set_config('request.jwt.claims', $1, true)", [
      userId === null ? null : JSON.stringify({ sub: userId }),
    ]);
    const res = await pg.query<{ ok: boolean }>(
      "select private.auth_user_is_member_of_tree($1) as ok",
      [orgId]
    );
    return res.rows[0]!.ok;
  } finally {
    await pg.query("rollback");
  }
}

async function main(): Promise<void> {
  const admin = createClient(URL!, SECRET!, { auth: { autoRefreshToken: false, persistSession: false } });
  // Plaintext only for the local stack; anything remote gets verified TLS.
  const isLocalDb = /@(localhost|127\.0\.0\.1)[:/]/.test(DB_URL);
  const pg = new Client({ connectionString: DB_URL, ssl: isLocalDb ? undefined : true });
  await pg.connect();

  try {
    await cleanup(admin);

    // Tree: grand -> parent -> child. Plus `other`, an unrelated root.
    const grandId = await makeOrg(admin, "Grand", null);
    const parentId = await makeOrg(admin, "Parent", grandId);
    const childId = await makeOrg(admin, "Child", parentId);
    const otherId = await makeOrg(admin, "Other", null);

    const uGrand = await makeMember(admin, grandId, EMAILS.grand);
    const uParent = await makeMember(admin, parentId, EMAILS.parent);
    const uChild = await makeMember(admin, childId, EMAILS.child);
    const uOther = await makeMember(admin, otherId, EMAILS.other);
    const uRemoved = await makeMember(admin, childId, EMAILS.removed);
    console.log(`\nSeeded "${PREFIX}" tree: Grand -> Parent -> Child (+ unrelated Other).`);

    // --- [1] Member of the org itself ----------------------------------------
    console.log("\n[1] Member of the org itself");
    check("child member -> child org is true", await isMemberOfTree(pg, uChild.userId, childId));
    check("grand member -> grand org is true", await isMemberOfTree(pg, uGrand.userId, grandId));

    // --- [2] Inheritance flows DOWN -------------------------------------------
    console.log("\n[2] Inheritance flows DOWN (parent member reaches the child)");
    check("parent member -> child org is true", await isMemberOfTree(pg, uParent.userId, childId));
    check("parent member -> parent org is true", await isMemberOfTree(pg, uParent.userId, parentId));

    // --- [3] NO upward leak (the security-critical case) -----------------------
    console.log("\n[3] NO upward leak (child member must NOT reach ancestors)");
    check("child member -> parent org is FALSE", !(await isMemberOfTree(pg, uChild.userId, parentId)));
    check("child member -> grand org is FALSE", !(await isMemberOfTree(pg, uChild.userId, grandId)));
    check("parent member -> grand org is FALSE", !(await isMemberOfTree(pg, uParent.userId, grandId)));

    // --- [4] Multi-level inheritance ------------------------------------------
    console.log("\n[4] Multi-level (grandparent member reaches the grandchild)");
    check("grand member -> child org is true", await isMemberOfTree(pg, uGrand.userId, childId));
    check("grand member -> parent org is true", await isMemberOfTree(pg, uGrand.userId, parentId));

    // --- [5] Non-member --------------------------------------------------------
    console.log("\n[5] Non-member (member of an unrelated org)");
    check("other-org member -> child org is false", !(await isMemberOfTree(pg, uOther.userId, childId)));
    check("other-org member -> grand org is false", !(await isMemberOfTree(pg, uOther.userId, grandId)));
    check("no sibling-subtree leak: child member -> other org is false",
      !(await isMemberOfTree(pg, uChild.userId, otherId)));

    // --- [6] Soft-deleted membership ------------------------------------------
    console.log("\n[6] Soft-deleted membership loses access");
    check("before soft-delete -> child org is true", await isMemberOfTree(pg, uRemoved.userId, childId));
    const soft = await admin
      .from("memberships")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", uRemoved.membershipId);
    if (soft.error) throw new Error(`soft-delete membership: ${soft.error.message}`);
    check("after soft-delete -> child org is FALSE", !(await isMemberOfTree(pg, uRemoved.userId, childId)));

    // Same rule one level up: soft-deleting the PARENT membership kills the
    // inherited access it was granting down the tree.
    const softParent = await admin
      .from("memberships")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", uParent.membershipId);
    if (softParent.error) throw new Error(`soft-delete parent membership: ${softParent.error.message}`);
    check("soft-deleted PARENT membership -> child org is FALSE (inheritance dies with it)",
      !(await isMemberOfTree(pg, uParent.userId, childId)));
    await admin.from("memberships").update({ deleted_at: null }).eq("id", uParent.membershipId);

    // --- [7] Anonymous ---------------------------------------------------------
    console.log("\n[7] Anonymous (auth.uid() is null)");
    check("anon -> child org is false", !(await isMemberOfTree(pg, null, childId)));

    // --- [8] Cycle guard -------------------------------------------------------
    console.log("\n[8] Cycle guard rejects a parent that is a descendant");
    const cycle = await admin.from("organizations").update({ parent_id: childId }).eq("id", grandId);
    check("DB rejects grand.parent := child (cycle)", !!cycle.error, cycle.error?.message ?? "");

    const selfParent = await admin.from("organizations").update({ parent_id: childId }).eq("id", childId);
    check("DB rejects child.parent := child (self-parent)", !!selfParent.error, selfParent.error?.message ?? "");

    // The tree must be intact after the rejected writes.
    const still = await admin.from("organizations").select("parent_id").eq("id", grandId).single();
    check("grand org is still a root after the rejected cycle write",
      !still.error && (still.data as { parent_id: string | null }).parent_id === null);

    // A legitimate re-parent still works (the guard is not just "deny all").
    const ok = await admin.from("organizations").update({ parent_id: grandId }).eq("id", otherId);
    check("legitimate re-parent (other.parent := grand) still succeeds", !ok.error, ok.error?.message ?? "");
    check("...and inheritance follows it: grand member -> other org is now true",
      await isMemberOfTree(pg, uGrand.userId, otherId));

    await cleanup(admin);
    console.log("\n(cleaned up test tree + users)\n");
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
