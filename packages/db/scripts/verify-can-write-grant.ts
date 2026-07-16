/**
 * Verification harness for `private.auth_user_can_write` and
 * `private.auth_user_can_grant` (migration 20260716000006).
 *
 * NOTHING IS WIRED — these functions are created unused, so there is no policy to
 * exercise them through. The harness therefore calls them DIRECTLY, as the
 * impersonated user (`set local role authenticated` + `request.jwt.claims`, which
 * is what auth.uid() reads), which is exactly the context a policy would call them
 * in. The `authenticated` role has USAGE on `private` and EXECUTE on both, so this
 * is a real client-context call, not a privileged one.
 *
 * Builds HQ -> Branch B / Branch C (plus an unrelated Other), then proves:
 *
 *   can_write — the same shape as can_read, with a hierarchical restricted branch:
 *     'org'        -> member writes; PARENT-org member writes (down); CHILD-org
 *                     member does not (no upward leak); non-member / anon do not.
 *     'private'    -> the owner writes; another tree member does not.
 *     'restricted' -> a 'read' grant does NOT write (the hierarchy proof);
 *                     'write' and 'grant' both do; no grant means nobody, the
 *                     owner included; a role grant works only for a user who
 *                     HOLDS the role, not for a mere member of the role's org.
 *
 *   can_grant — NARROWER, and the narrowness is the point:
 *     'grant' access -> true. 'write' -> FALSE ('write' does not confer granting).
 *     'read' -> false. No grant -> false, owner included.
 *     private + owner -> FALSE, org + member -> FALSE, org + admin -> FALSE.
 *     Those three are DELIBERATE omissions, not gaps: a grant on an 'org' row is a
 *     no-op (the tree already reads it), and a grant on a 'private' row can never
 *     fire (can_read's private branch has no grant branch beside it). They are
 *     asserted explicitly so nobody "completes the shape" later — the mutation
 *     test below exists precisely to prove these three are what the narrowness buys.
 *
 *   THE LEAKS — for both verbs, via role and via group: a user holds an HQ role
 *     (or is in an HQ group) AND has a DIRECT branch-C membership. The HQ
 *     membership is soft-deleted; `membership_roles` / `group_members` survive it
 *     (they cascade on hard delete only). is_member_of_tree(C) is still true via
 *     the direct membership, so the blocking AND does NOT save us — only the
 *     deleted_at checks do. Each asserts, as service_role, that the underlying row
 *     still exists, so the test proves deleted_at is what blocks.
 *
 * Connection approach mirrors verify-can-read.ts.
 *
 * Env: the usual Supabase vars from the root `.env`, plus SUPABASE_DB_URL.
 * Defaults to the local `supabase start` stack.
 *
 * Run:  pnpm --filter @platform/db exec tsx scripts/verify-can-write-grant.ts
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";

const rootEnv = resolve(process.cwd(), "../../.env");
dotenv.config({ path: existsSync(rootEnv) ? rootEnv : undefined });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;
const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!URL || !SECRET) throw new Error("Missing Supabase env in root .env");

const PREFIX = "CanWriteGrant Test"; // tag so cleanup is targeted
const EMAILS = {
  hq: "cwg-hq@canwritegrant.test",
  hqPlain: "cwg-hq-plain@canwritegrant.test",
  b: "cwg-branch-b@canwritegrant.test",
  c: "cwg-branch-c@canwritegrant.test",
  cAdmin: "cwg-branch-c-admin@canwritegrant.test",
  cOther: "cwg-branch-c-other@canwritegrant.test",
  other: "cwg-other@canwritegrant.test",
  leakRole: "cwg-leak-role@canwritegrant.test",
  leakGroup: "cwg-leak-group@canwritegrant.test",
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

async function holdRole(admin: SupabaseClient, membershipId: string, roleId: string, orgId: string): Promise<void> {
  const res = await admin
    .from("membership_roles")
    .insert({ membership_id: membershipId, role_id: roleId, organization_id: orgId });
  if (res.error) throw new Error(`hold role: ${res.error.message}`);
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

type Item = { id: string; orgId: string; ownerId: string; visibility: Visibility };

async function makeItem(
  admin: SupabaseClient,
  orgId: string,
  ownerId: string,
  name: string,
  visibility: Visibility
): Promise<Item> {
  const res = await admin
    .from("inventory_items")
    .insert({ org_id: orgId, owner_id: ownerId, name: `${PREFIX} ${name}`, visibility })
    .select("id")
    .single();
  if (res.error || !res.data) throw new Error(`create item ${name}: ${res.error?.message}`);
  return { id: (res.data as { id: string }).id, orgId, ownerId, visibility };
}

async function grant(admin: SupabaseClient, row: Record<string, string | null>): Promise<void> {
  const res = await admin.from("record_grants").insert(row);
  if (res.error) throw new Error(`grant: ${res.error.message}`);
}

type Verb = "auth_user_can_write" | "auth_user_can_grant";

/**
 * Calls the helper as `userId` (or anon, when null) would through a policy.
 * Wrapped in a rolled-back transaction so the `set local` cannot leak onward.
 */
async function ask(pg: Client, userId: string | null, verb: Verb, item: Item): Promise<boolean> {
  await pg.query("begin");
  try {
    await pg.query("set local role authenticated");
    await pg.query("select set_config('request.jwt.claims', $1, true)", [
      userId === null ? null : JSON.stringify({ sub: userId }),
    ]);
    // `verb` is a closed union of literals from this file — never user input.
    const res = await pg.query(
      `select private.${verb}('inventory_items', $1, $2, $3, $4) as ok`,
      [item.id, item.orgId, item.ownerId, item.visibility]
    );
    return res.rows[0].ok === true;
  } finally {
    await pg.query("rollback");
  }
}

const canWrite = (pg: Client, u: string | null, i: Item) => ask(pg, u, "auth_user_can_write", i);
const canGrant = (pg: Client, u: string | null, i: Item) => ask(pg, u, "auth_user_can_grant", i);

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
    const uHqPlain = await makeUser(admin, EMAILS.hqPlain);
    const uB = await makeUser(admin, EMAILS.b);
    const uC = await makeUser(admin, EMAILS.c);
    const uCAdmin = await makeUser(admin, EMAILS.cAdmin);
    const uCOther = await makeUser(admin, EMAILS.cOther);
    const uOther = await makeUser(admin, EMAILS.other);
    const uLeakRole = await makeUser(admin, EMAILS.leakRole);
    const uLeakGroup = await makeUser(admin, EMAILS.leakGroup);

    const mHq = await addMembership(admin, uHq, hq);
    await addMembership(admin, uHqPlain, hq);
    await addMembership(admin, uB, branchB);
    const mC = await addMembership(admin, uC, branchC);
    const mCAdmin = await addMembership(admin, uCAdmin, branchC);
    await addMembership(admin, uCOther, branchC);
    await addMembership(admin, uOther, otherOrg);

    // "Regional Manager" is an HQ role — the one both leak scenarios use.
    const roleRegionalMgr = await makeRole(admin, hq, "Regional Manager");
    const roleCLead = await makeRole(admin, branchC, "C Lead");
    const roleCAdmin = await makeRole(admin, branchC, "C Admin", true);

    await holdRole(admin, mHq, roleRegionalMgr, hq);
    await holdRole(admin, mC, roleCLead, branchC);
    // uCAdmin genuinely holds an is_admin role — so "admin is not a bypass" is a
    // real assertion, not a user who merely happens to be named "admin".
    await holdRole(admin, mCAdmin, roleCAdmin, branchC);

    const groupC = await makeGroup(admin, branchC, "C Group");
    await addToGroup(admin, groupC, uC, branchC);

    console.log(`\nSeeded "${PREFIX}": HQ -> Branch B / Branch C (+ unrelated Other).`);

    const T = "inventory_items";

    // =========================================================================
    // can_write
    // =========================================================================

    // --- [1] visibility='org' ---------------------------------------------------
    console.log("\n[1] can_write, visibility='org' — the org tree, downward only");
    const orgItemC = await makeItem(admin, branchC, uC, "org item in C", "org");
    const orgItemHq = await makeItem(admin, hq, uHq, "org item in HQ", "org");
    check("member of C writes C's org item", await canWrite(pg, uC, orgItemC));
    check("HQ member writes C's org item (inherits DOWN)", await canWrite(pg, uHq, orgItemC));
    check("member of C does NOT write HQ's org item (no upward leak)", !(await canWrite(pg, uC, orgItemHq)));
    check("member of B does NOT write C's org item (sibling)", !(await canWrite(pg, uB, orgItemC)));
    check("non-member does NOT write C's org item", !(await canWrite(pg, uOther, orgItemC)));
    check("anon does NOT write C's org item", !(await canWrite(pg, null, orgItemC)));

    // --- [2] visibility='private' ----------------------------------------------
    console.log("\n[2] can_write, visibility='private' — the owner only");
    const privItemC = await makeItem(admin, branchC, uC, "private item in C", "private");
    check("the OWNER writes their private item", await canWrite(pg, uC, privItemC));
    check("another member of the same org does NOT", !(await canWrite(pg, uCAdmin, privItemC)));
    check("an HQ (parent-org) member does NOT", !(await canWrite(pg, uHq, privItemC)));

    // --- [3] restricted — the access hierarchy ---------------------------------
    console.log("\n[3] can_write, visibility='restricted' — grant > write > read");
    const restrRead = await makeItem(admin, branchC, uC, "restricted read grant", "restricted");
    await grant(admin, { table_name: T, record_id: restrRead.id, org_id: branchC, subject_user_id: uCAdmin, access: "read", granted_by: uC });
    check(
      "a 'read' grant does NOT confer write",
      !(await canWrite(pg, uCAdmin, restrRead)),
      "the hierarchy proof"
    );

    const restrWrite = await makeItem(admin, branchC, uC, "restricted write grant", "restricted");
    await grant(admin, { table_name: T, record_id: restrWrite.id, org_id: branchC, subject_user_id: uCAdmin, access: "write", granted_by: uC });
    check("a 'write' grant confers write", await canWrite(pg, uCAdmin, restrWrite));

    const restrGrantLvl = await makeItem(admin, branchC, uC, "restricted grant grant", "restricted");
    await grant(admin, { table_name: T, record_id: restrGrantLvl.id, org_id: branchC, subject_user_id: uCAdmin, access: "grant", granted_by: uC });
    check("a 'grant' grant also confers write (hierarchical)", await canWrite(pg, uCAdmin, restrGrantLvl));

    const restrNoGrant = await makeItem(admin, branchC, uC, "restricted no grant", "restricted");
    check(
      "with NO grant, nobody writes — INCLUDING the owner",
      !(await canWrite(pg, uC, restrNoGrant)),
      "restricted is grants-only; the shell seeds defaultGrants at creation"
    );
    check("...and not an HQ member either", !(await canWrite(pg, uHq, restrNoGrant)));

    // --- [4] restricted + role grant — HOLDING, not org membership --------------
    console.log("\n[4] can_write, restricted + a ROLE grant — the user must HOLD the role");
    const restrRoleWrite = await makeItem(admin, branchC, uC, "restricted role write", "restricted");
    await grant(admin, { table_name: T, record_id: restrRoleWrite.id, org_id: branchC, subject_role_id: roleCLead, access: "write", granted_by: uC });
    check("a user who HOLDS the granted role writes it", await canWrite(pg, uC, restrRoleWrite));
    check(
      "a MEMBER of the role's org who does NOT hold it does not write",
      !(await canWrite(pg, uCOther, restrRoleWrite)),
      "the auth_user_can_access_role trap"
    );

    // =========================================================================
    // can_grant — narrower on purpose
    // =========================================================================
    console.log("\n[5] can_grant — only 'grant'-level grants on RESTRICTED rows");
    check("a 'grant' grant confers granting", await canGrant(pg, uCAdmin, restrGrantLvl));
    check(
      "a 'write' grant does NOT confer granting",
      !(await canGrant(pg, uCAdmin, restrWrite)),
      "changing a row != widening who sees it"
    );
    check("a 'read' grant does NOT confer granting", !(await canGrant(pg, uCAdmin, restrRead)));
    check("with NO grant, nobody grants — including the owner", !(await canGrant(pg, uC, restrNoGrant)));

    console.log("\n[6] can_grant's missing branches are DELIBERATE — assert them");
    check(
      "private + its OWNER -> FALSE",
      !(await canGrant(pg, uC, privItemC)),
      "a grant on a private row could never fire: can_read's private branch has no grant branch"
    );
    check(
      "org + a member -> FALSE",
      !(await canGrant(pg, uC, orgItemC)),
      "the whole tree already reads it; a grant would be a no-op row"
    );
    check(
      "org + an ADMIN of the org -> FALSE",
      !(await canGrant(pg, uCAdmin, orgItemC)),
      "admin is not a bypass here"
    );

    // --- [7] can_grant still needs membership ----------------------------------
    console.log("\n[7] can_grant does NOT bypass membership (the blocking AND)");
    const restrStranger = await makeItem(admin, branchC, uC, "restricted stranger grant", "restricted");
    // record_grants' trigger requires the subject to be in the tree, so uOther is
    // temporarily added to C, granted, then hard-removed — leaving a 'grant'-level
    // grant whose subject has no membership anywhere in C's tree.
    const tempMem = await addMembership(admin, uOther, branchC);
    await grant(admin, { table_name: T, record_id: restrStranger.id, org_id: branchC, subject_user_id: uOther, access: "grant", granted_by: uC });
    check("sanity: with a membership + 'grant' grant, can_grant is true", await canGrant(pg, uOther, restrStranger));
    const delMem = await admin.from("memberships").delete().eq("id", tempMem);
    if (delMem.error) throw new Error(`remove temp membership: ${delMem.error.message}`);
    const grantLives = await admin.from("record_grants").select("id").eq("record_id", restrStranger.id).eq("subject_user_id", uOther);
    check("the grant row still exists after the membership is removed", (grantLives.data?.length ?? 0) === 1, `${grantLives.data?.length ?? 0}`);
    check(
      "a 'grant'-granted user with NO membership in the tree -> false",
      !(await canGrant(pg, uOther, restrStranger)),
      "blocked by the AND"
    );

    // =========================================================================
    // THE LEAKS — stale membership_roles / group_members must not confer either verb
    // =========================================================================
    console.log("\n[8] THE LEAK (role): stale membership_roles must not confer write or grant");
    const mLeakHq = await addMembership(admin, uLeakRole, hq);
    await addMembership(admin, uLeakRole, branchC); // direct C membership survives
    await holdRole(admin, mLeakHq, roleRegionalMgr, hq);

    const leakRoleWrite = await makeItem(admin, branchC, uC, "leak role write", "restricted");
    await grant(admin, { table_name: T, record_id: leakRoleWrite.id, org_id: branchC, subject_role_id: roleRegionalMgr, access: "write", granted_by: uC });
    const leakRoleGrant = await makeItem(admin, branchC, uC, "leak role grant", "restricted");
    await grant(admin, { table_name: T, record_id: leakRoleGrant.id, org_id: branchC, subject_role_id: roleRegionalMgr, access: "grant", granted_by: uC });

    check("before: holding the HQ role, the user writes C's restricted row", await canWrite(pg, uLeakRole, leakRoleWrite));
    check("before: holding the HQ role, the user grants C's restricted row", await canGrant(pg, uLeakRole, leakRoleGrant));

    const softHq = await admin.from("memberships").update({ deleted_at: new Date().toISOString() }).eq("id", mLeakHq);
    if (softHq.error) throw new Error(`soft-delete HQ membership: ${softHq.error.message}`);

    const mrLives = await admin.from("membership_roles").select("role_id").eq("membership_id", mLeakHq).eq("role_id", roleRegionalMgr);
    check(
      "the membership_roles row SURVIVES the soft delete (cascade is hard-delete only)",
      (mrLives.data?.length ?? 0) === 1,
      `${mrLives.data?.length ?? 0} row(s) — so deleted_at, not a vanished row, must block`
    );
    check(
      "is_member_of_tree(C) is still TRUE via the direct C membership (the AND does not save us)",
      await canWrite(pg, uLeakRole, orgItemC),
      "writes C's 'org' item, proving they are still legitimately in C"
    );
    check("=> after leaving HQ, the user does NOT write the HQ-role-granted row", !(await canWrite(pg, uLeakRole, leakRoleWrite)));
    check("=> after leaving HQ, the user does NOT grant the HQ-role-granted row", !(await canGrant(pg, uLeakRole, leakRoleGrant)));

    console.log("\n[9] THE LEAK (group): stale group_members must not confer write or grant");
    const mLeakGroupHq = await addMembership(admin, uLeakGroup, hq);
    await addMembership(admin, uLeakGroup, branchC); // direct C membership survives
    const groupHq = await makeGroup(admin, hq, "HQ Group");
    await addToGroup(admin, groupHq, uLeakGroup, hq);

    const leakGroupWrite = await makeItem(admin, branchC, uC, "leak group write", "restricted");
    await grant(admin, { table_name: T, record_id: leakGroupWrite.id, org_id: branchC, subject_group_id: groupHq, access: "write", granted_by: uC });
    const leakGroupGrant = await makeItem(admin, branchC, uC, "leak group grant", "restricted");
    await grant(admin, { table_name: T, record_id: leakGroupGrant.id, org_id: branchC, subject_group_id: groupHq, access: "grant", granted_by: uC });

    check("before: in the HQ group, the user writes C's restricted row", await canWrite(pg, uLeakGroup, leakGroupWrite));
    check("before: in the HQ group, the user grants C's restricted row", await canGrant(pg, uLeakGroup, leakGroupGrant));

    const softGroupHq = await admin.from("memberships").update({ deleted_at: new Date().toISOString() }).eq("id", mLeakGroupHq);
    if (softGroupHq.error) throw new Error(`soft-delete HQ membership: ${softGroupHq.error.message}`);

    const gmLives = await admin.from("group_members").select("user_id").eq("group_id", groupHq).eq("user_id", uLeakGroup);
    check(
      "the group_members row SURVIVES the soft delete (cascade is hard-delete only)",
      (gmLives.data?.length ?? 0) === 1,
      `${gmLives.data?.length ?? 0} row(s) — so deleted_at, not a vanished row, must block`
    );
    check(
      "is_member_of_tree(C) is still TRUE via the direct C membership",
      await canWrite(pg, uLeakGroup, orgItemC)
    );
    check("=> after leaving HQ, the user does NOT write the HQ-group-granted row", !(await canWrite(pg, uLeakGroup, leakGroupWrite)));
    check("=> after leaving HQ, the user does NOT grant the HQ-group-granted row", !(await canGrant(pg, uLeakGroup, leakGroupGrant)));

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
