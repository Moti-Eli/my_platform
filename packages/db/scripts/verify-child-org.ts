/**
 * Verification harness for `createChildOrgWithMember` (@platform/auth).
 *
 * This is NOT part of the app — it exercises the REAL security boundary against
 * the REAL Supabase project with REAL RLS, by importing the SAME function the
 * server will call. It proves:
 *
 *   1. Provisioning is correct: two sibling child orgs under Org A, each with
 *      parent_id = Org A, the actor holding the child's is_admin role (the
 *      bootstrap exemption fired), each new member holding the child's
 *      non-admin Member role and able to log in.
 *   2. The gate holds with the SPECIFIC key "notAllowed" — for a plain Org A
 *      member and for the Org B admin (cross-tenant) — and NO organization row
 *      is created on rejection.
 *   3. Downward inheritance (positive control): the Org A admin reads notes in
 *      Org A AND in both children — including an Org A admin who is NOT a
 *      member of the children, which is tree inheritance in its pure form.
 *   4. A child cannot read its parent (with the paired positive control that
 *      the child's own row IS readable — a zero-row read proves nothing alone).
 *   5. Siblings cannot read each other; the child member's total visible notes
 *      is exactly 1.
 *
 * Run:  pnpm --filter @platform/db run verify:child-org
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createChildOrgWithMember } from "../../auth/src/index";

import { assertLocalDatabase } from "./db-guard";

// FIRST statement: refuse to run against a non-local database. This script WRITES.
// (db-guard loads the root .env itself, so this is safe before dotenv.config below.)
assertLocalDatabase("verify-child-org.ts");

const rootEnv = resolve(process.cwd(), "../../.env");
dotenv.config({ path: existsSync(rootEnv) ? rootEnv : undefined });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET = process.env.SUPABASE_SECRET_KEY;
if (!URL || !ANON || !SECRET) throw new Error("Missing Supabase env in root .env");

const TEMP_PASSWORD = "123456";

// Fixtures created by THIS harness (seeded data is never touched).
const CHILD_A_NAME = "Child Org A (verify)";
const CHILD_B_NAME = "Child Org B (verify)";
const DENIED_1_NAME = "Child Org Denied 1 (verify)";
const DENIED_2_NAME = "Child Org Denied 2 (verify)";
const EMP_A_EMAIL = "employee@childorga.com";
const EMP_B_EMAIL = "employee@childorgb.com";

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Sign in and return an authenticated client (RLS applies as that user). */
async function signInClient(email: string): Promise<{ client: SupabaseClient; userId: string }> {
  const client = createClient(URL!, ANON!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password: TEMP_PASSWORD });
  if (error || !data.user) throw new Error(`sign in ${email}: ${error?.message ?? "no user"}`);
  return { client, userId: data.user.id };
}

async function orgIdByName(admin: SupabaseClient, name: string): Promise<string> {
  const res = await admin.from("organizations").select("id").eq("name", name).single();
  if (res.error || !res.data) throw new Error(`org ${name}: ${res.error?.message}`);
  return (res.data as { id: string }).id;
}

/** Whether the user holds a role with the given is_admin flag in the org (service read). */
async function holdsRole(
  admin: SupabaseClient,
  userId: string,
  organizationId: string,
  wantAdmin: boolean
): Promise<boolean> {
  const mRes = await admin
    .from("memberships")
    .select("id")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (mRes.error || !mRes.data) return false;
  const mrRes = await admin
    .from("membership_roles")
    .select("role_id")
    .eq("membership_id", (mRes.data as { id: string }).id);
  if (mrRes.error) return false;
  const roleIds = ((mrRes.data ?? []) as Array<{ role_id: string }>).map((r) => r.role_id);
  if (roleIds.length === 0) return false;
  const rolesRes = await admin.from("roles").select("is_admin").in("id", roleIds);
  if (rolesRes.error) return false;
  return ((rolesRes.data ?? []) as Array<{ is_admin: boolean }>).some(
    (r) => Boolean(r.is_admin) === wantAdmin
  );
}

async function main(): Promise<void> {
  const admin = createClient(URL!, SECRET!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const orgA = await orgIdByName(admin, "Organization A");

  // --- Pre-clean: remove leftovers from a previous (possibly failed) run. ----
  // Orgs FIRST (org deletion cascades notes/roles/memberships via org_id), THEN
  // the users — the reverse would trip notes.owner_id's NO ACTION if a leftover
  // note existed. Our notes are owned by the seeded admin, so org-cascade
  // removes them and the seeded admin is never deleted.
  const leftoverOrgs = await admin
    .from("organizations")
    .select("id, name")
    .in("name", [CHILD_A_NAME, CHILD_B_NAME, DENIED_1_NAME, DENIED_2_NAME]);
  for (const o of (leftoverOrgs.data ?? []) as Array<{ id: string; name: string }>) {
    await admin.from("organizations").delete().eq("id", o.id);
  }
  const pre = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of pre.data.users) {
    if (u.email === EMP_A_EMAIL || u.email === EMP_B_EMAIL) await admin.auth.admin.deleteUser(u.id);
  }

  // --- Setup: the Org A admin provisions two sibling children under Org A ----
  console.log("\n[setup] Org A admin creates two sibling child orgs");
  const { client: adminAClient, userId: adminAId } = await signInClient("admin1@organizationA.com");

  const resA = await createChildOrgWithMember(adminAClient, admin, {
    organizationName: CHILD_A_NAME,
    parentOrganizationId: orgA,
    email: EMP_A_EMAIL,
    displayName: "Child A Employee",
    password: TEMP_PASSWORD,
  });
  check("child A provisioned (error null)", resA.error === null, resA.error ?? "");
  const resB = await createChildOrgWithMember(adminAClient, admin, {
    organizationName: CHILD_B_NAME,
    parentOrganizationId: orgA,
    email: EMP_B_EMAIL,
    displayName: "Child B Employee",
    password: TEMP_PASSWORD,
  });
  check("child B provisioned (error null)", resB.error === null, resB.error ?? "");
  if (!resA.organizationId || !resA.userId || !resB.organizationId || !resB.userId) {
    console.log("\nRESULT: setup failed — cannot continue");
    process.exit(1);
  }
  const childA = resA.organizationId;
  const childB = resB.organizationId;
  const empAId = resA.userId;
  const empBId = resB.userId;

  // --- Scenario 1: provisioning is correct -----------------------------------
  console.log("\n[1] Provisioning is correct");
  const orgRows = await admin
    .from("organizations")
    .select("id, parent_id")
    .in("id", [childA, childB]);
  const parentById = new Map(
    ((orgRows.data ?? []) as Array<{ id: string; parent_id: string | null }>).map((o) => [
      o.id,
      o.parent_id,
    ])
  );
  check("child A has parent_id = Org A", parentById.get(childA) === orgA);
  check("child B has parent_id = Org A", parentById.get(childB) === orgA);

  check(
    "actor holds is_admin role in child A (bootstrap exemption fired)",
    await holdsRole(admin, adminAId, childA, true)
  );
  check(
    "actor holds is_admin role in child B (bootstrap exemption fired)",
    await holdsRole(admin, adminAId, childB, true)
  );
  check(
    "employee A holds child A's non-admin Member role",
    await holdsRole(admin, empAId, childA, false)
  );
  check(
    "employee B holds child B's non-admin Member role",
    await holdsRole(admin, empBId, childB, false)
  );

  const empALogin = await signInClient(EMP_A_EMAIL).then(
    () => true,
    () => false
  );
  check("employee A can log in with the given password", empALogin);
  const empBLogin = await signInClient(EMP_B_EMAIL).then(
    () => true,
    () => false
  );
  check("employee B can log in with the given password", empBLogin);

  // --- Scenario 2: the gate holds (exact key, and NO org row created) --------
  console.log("\n[2] The gate holds — exact 'notAllowed', no org row created");
  const { client: memberClient } = await signInClient("user1@organizationA.com");
  const denied1 = await createChildOrgWithMember(memberClient, admin, {
    organizationName: DENIED_1_NAME,
    parentOrganizationId: orgA,
    email: "denied1@childorga.com",
    displayName: "Denied One",
    password: TEMP_PASSWORD,
  });
  check(
    "plain Org A member rejected with EXACTLY 'notAllowed'",
    denied1.error === "notAllowed",
    `got ${JSON.stringify(denied1.error)}`
  );
  const denied1Org = await admin.from("organizations").select("id").eq("name", DENIED_1_NAME);
  check("no organization row was created for the member's attempt", (denied1Org.data ?? []).length === 0);

  const { client: adminBClient } = await signInClient("admin1@organizationB.com");
  const denied2 = await createChildOrgWithMember(adminBClient, admin, {
    organizationName: DENIED_2_NAME,
    parentOrganizationId: orgA,
    email: "denied2@childorga.com",
    displayName: "Denied Two",
    password: TEMP_PASSWORD,
  });
  check(
    "Org B admin rejected cross-tenant with EXACTLY 'notAllowed'",
    denied2.error === "notAllowed",
    `got ${JSON.stringify(denied2.error)}`
  );
  const denied2Org = await admin.from("organizations").select("id").eq("name", DENIED_2_NAME);
  check("no organization row was created for the cross-tenant attempt", (denied2Org.data ?? []).length === 0);

  // --- Scenario 3: downward inheritance works (positive control) -------------
  console.log("\n[3] Downward inheritance (positive control)");
  // Insert one note per org AS THE ACTING ADMIN (the INSERT policy pins
  // owner_id = auth.uid(), so the rows must be theirs).
  const noteIds: string[] = [];
  for (const [orgId, title] of [
    [orgA, "verify-child-org: parent note"],
    [childA, "verify-child-org: child A note"],
    [childB, "verify-child-org: child B note"],
  ] as Array<[string, string]>) {
    const ins = await adminAClient
      .from("notes")
      .insert({ org_id: orgId, owner_id: adminAId, title })
      .select("id")
      .single();
    check(`note inserted in org ${title.slice(-13)}`, !ins.error && !!ins.data, ins.error?.message ?? "");
    if (ins.data) noteIds.push((ins.data as { id: string }).id);
  }
  const [noteParent, noteChildA, noteChildB] = noteIds;

  const adminReads = await adminAClient.from("notes").select("id").in("id", noteIds);
  const adminVisible = new Set(((adminReads.data ?? []) as Array<{ id: string }>).map((n) => n.id));
  check(
    "Org A admin reads all three notes (parent + both children)",
    noteIds.length === 3 && noteIds.every((id) => adminVisible.has(id))
  );

  // The PURE tree-inheritance proof: admin2 is an Org A admin who is NOT a
  // member of either child, so reading a child note can only come from
  // membership-of-an-ancestor (auth_user_is_member_of_tree).
  const { client: admin2Client } = await signInClient("admin2@organizationA.com");
  const admin2Read = await admin2Client.from("notes").select("id").eq("id", noteChildA);
  check(
    "Org A admin WITHOUT child membership reads the child A note (tree inheritance)",
    (admin2Read.data ?? []).length === 1
  );

  // --- Scenario 4: a child cannot read its parent ----------------------------
  console.log("\n[4] A child cannot read its parent");
  const { client: empAClient } = await signInClient(EMP_A_EMAIL);
  const empAPair = await empAClient.from("notes").select("id").in("id", [noteParent, noteChildA]);
  const empAPairIds = new Set(((empAPair.data ?? []) as Array<{ id: string }>).map((n) => n.id));
  check("employee A reads the child A note (positive control — reads work)", empAPairIds.has(noteChildA));
  check("employee A does NOT read the parent Org A note", !empAPairIds.has(noteParent));

  // --- Scenario 5: siblings cannot read each other ---------------------------
  console.log("\n[5] Siblings cannot read each other");
  const empAAll = await empAClient.from("notes").select("id");
  const empAAllIds = ((empAAll.data ?? []) as Array<{ id: string }>).map((n) => n.id);
  check("employee A does NOT read the child B note", !empAAllIds.includes(noteChildB));
  check(
    "employee A's total visible notes count is EXACTLY 1",
    empAAllIds.length === 1,
    `saw ${empAAllIds.length}`
  );

  // --- Cleanup (ORDER MATTERS) ----------------------------------------------
  // 1) notes FIRST: notes.owner_id references users with NO ACTION, so a user
  //    who still owns rows cannot be deleted. 2) then the created auth users.
  //    3) then the child orgs (org deletion cascades roles/memberships — and
  //    would cascade any notes via org_id, but ours are already gone).
  //    Seeded data is left intact.
  if (noteIds.length > 0) await admin.from("notes").delete().in("id", noteIds);
  await admin.auth.admin.deleteUser(empAId);
  await admin.auth.admin.deleteUser(empBId);
  await admin.from("organizations").delete().eq("id", childA);
  await admin.from("organizations").delete().eq("id", childB);
  console.log("\n(cleaned up: notes → employees → child orgs; seeded data untouched)\n");

  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error("VERIFY FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
