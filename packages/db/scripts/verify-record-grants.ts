/**
 * Verification harness for `record_grants` (migration 20260716000004).
 *
 * Builds a throwaway parent -> child org pair plus an unrelated org, each with a
 * role and a group, and proves the three things this table is made of:
 *
 *   SEALED FROM CLIENTS (the load-bearing RLS assertion):
 *     1. `authenticated` gets NOTHING from record_grants — not an empty result
 *        set as a courtesy, but no privilege at all — even for a member of the
 *        grant's own org who is the grant's own SUBJECT. A grant row leaks that a
 *        record exists and who can see it, so the table is invisible, not
 *        read-only. anon likewise. service_role can read it.
 *
 *   SHAPE CONSTRAINTS:
 *     2. Exactly one subject column: two set -> rejected, zero set -> rejected,
 *        one -> accepted.
 *     3. access = 'admin' -> rejected by the CHECK.
 *     4. Duplicate (table_name, record_id, subject_user_id) -> rejected, while
 *        the SAME (table_name, record_id) granted to a user AND a role AND a
 *        group is accepted — the three partial indexes must not collide.
 *
 *   SUBJECT MUST BE IN THE ORG TREE (the trigger):
 *     5. Role of the row's own org        -> ok
 *        Role of the PARENT org           -> ok    <- the case equality would break
 *        Role of an UNRELATED org         -> raises
 *        Role of a CHILD org              -> raises (no upward inheritance)
 *        User with no membership in tree  -> raises
 *        User with a SOFT-DELETED membership -> raises (membership precedes grant)
 *
 *   CASCADE (why the subject side is three real FKs and not a polymorphic pair):
 *     6. Deleting a group reaps its grants; deleting a role likewise.
 *
 * Connection approach mirrors verify-groups.ts: setup/teardown through the
 * service-role client, and client-side reads through a direct Postgres connection
 * that impersonates each user exactly as the API does (`set local role
 * authenticated` + `request.jwt.claims`, which is what auth.uid() reads), so the
 * real grants — or here, their total absence — are what get exercised.
 *
 * Env: the usual Supabase vars from the root `.env`, plus SUPABASE_DB_URL (the
 * Postgres connection string). Defaults to the local `supabase start` stack.
 *
 * Run:  pnpm --filter @platform/db exec tsx scripts/verify-record-grants.ts
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

const PREFIX = "RecordGrants Test"; // tag so cleanup is targeted
const EMAILS = {
  parent: "rg-parent@recordgrants.test",
  child: "rg-child@recordgrants.test",
  other: "rg-other@recordgrants.test",
};

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { passed++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

async function cleanup(admin: SupabaseClient): Promise<void> {
  // parent_id is ON DELETE RESTRICT, so break the links before deleting. Orgs
  // must go FIRST: record_grants cascades away with its org, which clears the
  // granted_by references (NO ACTION) before the users are deleted below.
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

async function makeRole(admin: SupabaseClient, orgId: string, name: string): Promise<string> {
  const res = await admin
    .from("roles")
    .insert({ organization_id: orgId, name: `${PREFIX} ${name}` })
    .select("id")
    .single();
  if (res.error || !res.data) throw new Error(`create role ${name}: ${res.error?.message}`);
  return (res.data as { id: string }).id;
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

async function makeItem(admin: SupabaseClient, orgId: string, ownerId: string, name: string): Promise<string> {
  const res = await admin
    .from("inventory_items")
    .insert({ org_id: orgId, owner_id: ownerId, name: `${PREFIX} ${name}`, visibility: "restricted" })
    .select("id")
    .single();
  if (res.error || !res.data) throw new Error(`create item ${name}: ${res.error?.message}`);
  return (res.data as { id: string }).id;
}

type Grant = {
  table_name?: string;
  record_id?: string;
  org_id?: string;
  subject_user_id?: string | null;
  subject_role_id?: string | null;
  subject_group_id?: string | null;
  access?: string;
  granted_by?: string;
};

/** Insert a grant as service_role; returns the error message, or null on success. */
async function grantErr(admin: SupabaseClient, row: Grant): Promise<string | null> {
  const res = await admin.from("record_grants").insert(row);
  return res.error ? res.error.message : null;
}

/**
 * What does a client role get from record_grants? Returns "denied" when the role
 * has no privilege at all (the sealed case), "rows:N" when it can actually read.
 * Impersonates the user the way a real API request does, inside a rolled-back
 * transaction so the `set local` cannot leak into the next call.
 */
async function clientRead(pg: Client, userId: string | null): Promise<string> {
  await pg.query("begin");
  try {
    await pg.query("set local role authenticated");
    await pg.query("select set_config('request.jwt.claims', $1, true)", [
      userId === null ? null : JSON.stringify({ sub: userId }),
    ]);
    const res = await pg.query("select * from public.record_grants");
    return `rows:${res.rowCount ?? 0}`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return /permission denied/i.test(msg) ? "denied" : `error:${msg}`;
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

    const roleParent = await makeRole(admin, parentOrg, "parent role");
    const roleChild = await makeRole(admin, childOrg, "child role");
    const roleOther = await makeRole(admin, otherOrg, "other role");

    const groupChild = await makeGroup(admin, childOrg, "child group");

    // The granted row: a 'restricted' item in the CHILD org — precisely the kind
    // of row 20260716000002 left readable by nobody pending this table.
    const item = await makeItem(admin, childOrg, uChild, "restricted item");
    const T = "inventory_items";
    console.log(`\nSeeded "${PREFIX}": Parent -> Child (+ unrelated Other), roles, a group, a restricted item.`);

    // --- [1] The table is SEALED to client roles -------------------------------
    console.log("\n[1] record_grants is invisible to clients (RLS on, no policies, no grants)");
    const seedGrant = await grantErr(admin, {
      table_name: T, record_id: item, org_id: childOrg,
      subject_user_id: uChild, access: "read", granted_by: uChild,
    });
    check("service_role can INSERT a grant", seedGrant === null, seedGrant ?? "");

    const asSubject = await clientRead(pg, uChild);
    check(
      "the grant's OWN SUBJECT (a member of the org) gets NOTHING",
      asSubject === "denied",
      asSubject
    );
    const asParent = await clientRead(pg, uParent);
    check("a parent-org member gets NOTHING", asParent === "denied", asParent);
    const asOther = await clientRead(pg, uOther);
    check("a non-member gets NOTHING", asOther === "denied", asOther);
    const asAnon = await clientRead(pg, null);
    check("anon gets NOTHING", asAnon === "denied", asAnon);

    const svc = await admin.from("record_grants").select("id").eq("record_id", item);
    check(
      "service_role CAN read it",
      !svc.error && (svc.data?.length ?? 0) === 1,
      svc.error?.message ?? `${svc.data?.length ?? 0} row(s)`
    );

    // --- [2] Exactly one subject column ----------------------------------------
    console.log("\n[2] Exactly one subject column must be set");
    const twoSubjects = await grantErr(admin, {
      table_name: T, record_id: item, org_id: childOrg,
      subject_user_id: uParent, subject_role_id: roleChild, access: "read", granted_by: uChild,
    });
    check("TWO subject columns is REJECTED", twoSubjects !== null, twoSubjects ?? "NO ERROR");

    const zeroSubjects = await grantErr(admin, {
      table_name: T, record_id: item, org_id: childOrg, access: "read", granted_by: uChild,
    });
    check("ZERO subject columns is REJECTED", zeroSubjects !== null, zeroSubjects ?? "NO ERROR");

    // --- [3] access is a closed vocabulary -------------------------------------
    console.log("\n[3] access is constrained to read/write/grant");
    const badAccess = await grantErr(admin, {
      table_name: T, record_id: item, org_id: childOrg,
      subject_role_id: roleChild, access: "admin", granted_by: uChild,
    });
    check("access = 'admin' is REJECTED by the CHECK", badAccess !== null, badAccess ?? "NO ERROR");

    // --- [4] Uniqueness — per subject kind, without collisions ------------------
    console.log("\n[4] One grant per (record, subject); the three partial indexes don't collide");
    const dupUser = await grantErr(admin, {
      table_name: T, record_id: item, org_id: childOrg,
      subject_user_id: uChild, access: "write", granted_by: uChild,
    });
    check(
      "duplicate (table_name, record_id, subject_user_id) is REJECTED",
      dupUser !== null,
      dupUser ?? "NO ERROR — the partial unique index did not fire"
    );

    // uChild is already granted on (T, item) from [1]. Add a role and a group on
    // the SAME (table_name, record_id): each lands in a different partial index.
    const sameRecRole = await grantErr(admin, {
      table_name: T, record_id: item, org_id: childOrg,
      subject_role_id: roleChild, access: "read", granted_by: uChild,
    });
    check("...the same record ALSO granted to a ROLE is accepted", sameRecRole === null, sameRecRole ?? "");

    const sameRecGroup = await grantErr(admin, {
      table_name: T, record_id: item, org_id: childOrg,
      subject_group_id: groupChild, access: "read", granted_by: uChild,
    });
    check("...the same record ALSO granted to a GROUP is accepted", sameRecGroup === null, sameRecGroup ?? "");

    const all3 = await admin.from("record_grants").select("id").eq("record_id", item);
    check("=> all three subject kinds coexist on one record", (all3.data?.length ?? 0) === 3, `${all3.data?.length ?? 0} grants`);

    // Changing a level is an UPDATE, not a second row.
    const upd = await admin
      .from("record_grants")
      .update({ access: "write" })
      .eq("record_id", item)
      .eq("subject_user_id", uChild);
    check("changing access level is an UPDATE (not a second row)", !upd.error, upd.error?.message ?? "");

    // --- [5] The subject must live in the granted row's ORG TREE ----------------
    console.log("\n[5] Trigger: the subject must be in the record's org tree (self + ANCESTORS)");

    // Own org: already proven by roleChild above. Parent org is the real question.
    const parentRoleGrant = await grantErr(admin, {
      table_name: T, record_id: item, org_id: childOrg,
      subject_role_id: roleParent, access: "read", granted_by: uChild,
    });
    check(
      "role of the PARENT org is ACCEPTED (equality would break this)",
      parentRoleGrant === null,
      parentRoleGrant ?? ""
    );

    const otherRoleGrant = await grantErr(admin, {
      table_name: T, record_id: item, org_id: childOrg,
      subject_role_id: roleOther, access: "read", granted_by: uChild,
    });
    check("role of an UNRELATED org RAISES", otherRoleGrant !== null, otherRoleGrant ?? "NO ERROR");

    // A CHILD org's role on a PARENT org's row: a child is not an ancestor.
    const parentItem = await makeItem(admin, parentOrg, uParent, "parent restricted item");
    const childRoleUp = await grantErr(admin, {
      table_name: T, record_id: parentItem, org_id: parentOrg,
      subject_role_id: roleChild, access: "read", granted_by: uParent,
    });
    check("role of a CHILD org RAISES (no upward inheritance)", childRoleUp !== null, childRoleUp ?? "NO ERROR");

    const strangerGrant = await grantErr(admin, {
      table_name: T, record_id: item, org_id: childOrg,
      subject_user_id: uOther, access: "read", granted_by: uChild,
    });
    check("user with no membership in the tree RAISES", strangerGrant !== null, strangerGrant ?? "NO ERROR");

    // A parent-org member IS in the child row's tree, so this must work — the
    // control that proves the previous assertion isn't just "all user grants fail".
    const parentUserGrant = await grantErr(admin, {
      table_name: T, record_id: item, org_id: childOrg,
      subject_user_id: uParent, access: "read", granted_by: uChild,
    });
    check("user who is a PARENT-org member is ACCEPTED", parentUserGrant === null, parentUserGrant ?? "");

    // --- [6] Cascade: deleting a subject reaps its grants ----------------------
    // Done before the soft-delete case, which retires uChild's membership.
    console.log("\n[6] Deleting a subject cascades its grants away (why the subject side is real FKs)");
    const beforeGroupDel = await admin.from("record_grants").select("id").eq("subject_group_id", groupChild);
    check("a group grant exists to begin with", (beforeGroupDel.data?.length ?? 0) === 1, `${beforeGroupDel.data?.length ?? 0}`);
    const delGroup = await admin.from("groups").delete().eq("id", groupChild);
    if (delGroup.error) throw new Error(`delete group: ${delGroup.error.message}`);
    const afterGroupDel = await admin.from("record_grants").select("id").eq("subject_group_id", groupChild);
    check(
      "deleting the GROUP reaped its grants",
      (afterGroupDel.data?.length ?? 0) === 0,
      `${afterGroupDel.data?.length ?? 0} left`
    );

    const beforeRoleDel = await admin.from("record_grants").select("id").eq("subject_role_id", roleChild);
    check("a role grant exists to begin with", (beforeRoleDel.data?.length ?? 0) === 1, `${beforeRoleDel.data?.length ?? 0}`);
    const delRole = await admin.from("roles").delete().eq("id", roleChild);
    if (delRole.error) throw new Error(`delete role: ${delRole.error.message}`);
    const afterRoleDel = await admin.from("record_grants").select("id").eq("subject_role_id", roleChild);
    check(
      "deleting the ROLE reaped its grants",
      (afterRoleDel.data?.length ?? 0) === 0,
      `${afterRoleDel.data?.length ?? 0} left`
    );

    // --- [7] Soft-deleted membership doesn't count -----------------------------
    console.log("\n[7] A SOFT-DELETED membership does not satisfy the trigger");
    const soft = await admin
      .from("memberships")
      .update({ deleted_at: new Date().toISOString() })
      .eq("user_id", uChild)
      .eq("organization_id", childOrg);
    if (soft.error) throw new Error(`soft-delete membership: ${soft.error.message}`);

    const softGrant = await grantErr(admin, {
      table_name: T, record_id: parentItem, org_id: childOrg,
      subject_user_id: uChild, access: "read", granted_by: uParent,
    });
    check(
      "granting to a user whose membership is SOFT-DELETED RAISES",
      softGrant !== null,
      softGrant ?? "NO ERROR — an offboarded user was granted access"
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
