/**
 * Verification harness for the ADMIN read path into 'private' rows
 * (migration 20260723000003_admin_private_read.sql).
 *
 * Exercises `private.auth_user_can_read` end to end through `inventory_items` —
 * the ONLY table whose SELECT policy is wired to that function, so the only
 * place the change is observable through the client API. It proves:
 *
 *   1. The owner reads their own 'private' row (positive control — must pass
 *      in BOTH states; if this fails the harness itself is broken).
 *   2. A different non-admin member does NOT read it (unchanged behaviour).
 *   3. An 'org' row stays readable by everyone in the tree (regression control).
 *   4. ✱ An Org A ADMIN reads the member's 'private' row — the NEW behaviour.
 *   5. ✱ The Org A admin reads a 'private' row in a CHILD org (ancestor walk).
 *   6. Downward only: an admin of the CHILD org gets NO reach upward into the
 *      parent's 'private' rows (must pass in BOTH states).
 *
 * ✱ = MUST FAIL before 20260723000003 is applied, and pass after. The
 * pre-migration failure is the proof these checks test something — do NOT
 * soften them to make a pre-migration run green.
 *
 * Run:  pnpm --filter @platform/db run verify:admin-private
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createChildOrgWithMember } from "../../auth/src/index";

import { assertLocalDatabase } from "./db-guard";

// FIRST statement: refuse to run against a non-local database. This script WRITES.
// (db-guard loads the root .env itself, so this is safe before dotenv.config below.)
assertLocalDatabase("verify-admin-private-read.ts");

const rootEnv = resolve(process.cwd(), "../../.env");
dotenv.config({ path: existsSync(rootEnv) ? rootEnv : undefined });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET = process.env.SUPABASE_SECRET_KEY;
if (!URL || !ANON || !SECRET) throw new Error("Missing Supabase env in root .env");

const TEMP_PASSWORD = "123456";

// Fixtures created by THIS harness (seeded data is never touched). Rows carry a
// unique name prefix so the pre-clean can find leftovers from a failed run.
const ROW_PREFIX = "verify-admin-private-read:";
const CHILD_NAME = "APR Child Org (verify)";
const EMP_EMAIL = "employee@aprchild.com";

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

/** Whether a client can read the given inventory row (RLS-filtered SELECT by id). */
async function canRead(client: SupabaseClient, rowId: string): Promise<boolean> {
  const res = await client.from("inventory_items").select("id").eq("id", rowId);
  if (res.error) throw new Error(`read inventory ${rowId}: ${res.error.message}`);
  return ((res.data ?? []) as Array<{ id: string }>).length === 1;
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
  console.log("");
  console.log("==============================================================");
  console.log(" verify-admin-private-read — admin read path into 'private'");
  console.log("");
  console.log(" BEFORE migration 20260723000003 is applied, the checks in");
  console.log(" sections [4] and [5] (marked ✱) MUST FAIL — that failure is");
  console.log(" the proof they test the new behaviour. Every other check must");
  console.log(" pass in BOTH states. After the migration, everything passes.");
  console.log("==============================================================");

  const admin = createClient(URL!, SECRET!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const orgA = await orgIdByName(admin, "Organization A");

  // --- Pre-clean: remove leftovers from a previous (possibly failed) run. ----
  // Inventory rows FIRST (inventory_items.owner_id references users with NO
  // ACTION, so a user who still owns rows cannot be deleted), THEN the created
  // employee user, THEN the child org. Seeded data is never deleted.
  await admin.from("inventory_items").delete().like("name", `${ROW_PREFIX}%`);
  const pre = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of pre.data.users) {
    if (u.email === EMP_EMAIL) await admin.auth.admin.deleteUser(u.id);
  }
  const leftoverOrg = await admin.from("organizations").select("id").eq("name", CHILD_NAME);
  for (const o of (leftoverOrg.data ?? []) as Array<{ id: string }>) {
    await admin.from("organizations").delete().eq("id", o.id);
  }

  // --- Setup ------------------------------------------------------------------
  // A plain Org A member inserts one 'private' row and one 'org' row through the
  // RLS client (the INSERT policy pins owner_id = auth.uid()). Then the Org A
  // admin provisions a child org with an employee, who inserts a 'private' row
  // of their own there.
  console.log("\n[setup] rows in Org A + a child org with an employee");
  const { client: memberClient, userId: memberId } = await signInClient("user1@organizationA.com");

  const insPrivate = await memberClient
    .from("inventory_items")
    .insert({
      org_id: orgA,
      owner_id: memberId,
      visibility: "private",
      name: `${ROW_PREFIX} orgA private row`,
    })
    .select("id")
    .single();
  check("member inserted a 'private' row in Org A", !insPrivate.error && !!insPrivate.data, insPrivate.error?.message ?? "");

  const insOrg = await memberClient
    .from("inventory_items")
    .insert({
      org_id: orgA,
      owner_id: memberId,
      visibility: "org",
      name: `${ROW_PREFIX} orgA org row`,
    })
    .select("id")
    .single();
  check("member inserted an 'org' row in Org A", !insOrg.error && !!insOrg.data, insOrg.error?.message ?? "");

  const { client: adminAClient } = await signInClient("admin1@organizationA.com");
  const child = await createChildOrgWithMember(adminAClient, admin, {
    organizationName: CHILD_NAME,
    parentOrganizationId: orgA,
    email: EMP_EMAIL,
    displayName: "APR Child Employee",
    password: TEMP_PASSWORD,
  });
  check("child org provisioned (error null)", child.error === null, child.error ?? "");

  if (!insPrivate.data || !insOrg.data || !child.organizationId || !child.userId) {
    console.log("\nRESULT: setup failed — cannot continue");
    process.exit(1);
  }
  const privateRow = (insPrivate.data as { id: string }).id;
  const orgRow = (insOrg.data as { id: string }).id;
  const childOrg = child.organizationId;
  const empId = child.userId;

  const { client: empClient } = await signInClient(EMP_EMAIL);
  const insChild = await empClient
    .from("inventory_items")
    .insert({
      org_id: childOrg,
      owner_id: empId,
      visibility: "private",
      name: `${ROW_PREFIX} child private row`,
    })
    .select("id")
    .single();
  check("employee inserted a 'private' row in the child org", !insChild.error && !!insChild.data, insChild.error?.message ?? "");
  if (!insChild.data) {
    console.log("\nRESULT: setup failed — cannot continue");
    process.exit(1);
  }
  const childPrivateRow = (insChild.data as { id: string }).id;

  // --- Scenario 1: the owner reads their own private row (positive control) ---
  console.log("\n[1] Owner reads their own 'private' row (positive control)");
  check("member (owner) reads their own private row", await canRead(memberClient, privateRow));
  check("employee (owner) reads their own child private row", await canRead(empClient, childPrivateRow));

  // --- Scenario 2: a different non-admin member does NOT read it --------------
  console.log("\n[2] A different non-admin member does NOT read a 'private' row");
  const { client: member2Client } = await signInClient("user2@organizationA.com");
  check("other Org A member does NOT read the private row", !(await canRead(member2Client, privateRow)));

  // --- Scenario 3: the 'org' row is still readable by everyone (regression) ---
  console.log("\n[3] The 'org' row stays readable by the tree (regression control)");
  check("owner reads the 'org' row", await canRead(memberClient, orgRow));
  check("other Org A member reads the 'org' row", await canRead(member2Client, orgRow));
  check("Org A admin reads the 'org' row", await canRead(adminAClient, orgRow));

  // --- Scenario 4: ✱ an Org A ADMIN reads the member's private row ------------
  console.log("\n[4] ✱ Org A ADMIN reads the member's 'private' row (NEW — fails pre-migration)");
  check("✱ Org A admin reads the member's private row", await canRead(adminAClient, privateRow));

  // --- Scenario 5: ✱ tree walk — the Org A admin reads the CHILD's private row -
  console.log("\n[5] ✱ Ancestor walk — Org A admin reads the child org's 'private' row (fails pre-migration)");
  check("✱ Org A admin reads the employee's private row in the child org", await canRead(adminAClient, childPrivateRow));

  // --- Scenario 6: downward only — a CHILD admin gets no reach upward ---------
  console.log("\n[6] Downward only — a child-org admin does NOT read the parent's 'private' row");
  // Promote the employee to admin of their OWN child org through the real path:
  // the set_member_role RPC, called AS the Org A admin (who holds the child's
  // is_admin role via the provisioning bootstrap, so the escalation guard admits
  // the call). Then VERIFY the promotion took — without that, the negative check
  // below would pass vacuously if the RPC silently failed.
  const empMembership = await admin
    .from("memberships")
    .select("id")
    .eq("user_id", empId)
    .eq("organization_id", childOrg)
    .single();
  if (empMembership.error || !empMembership.data) {
    throw new Error(`employee membership lookup: ${empMembership.error?.message}`);
  }
  const rpc = await adminAClient.rpc("set_member_role", {
    p_membership_id: (empMembership.data as { id: string }).id,
    p_target_role: "admin",
  });
  check("employee promoted to child-org admin via set_member_role (error null)", rpc.error === null, rpc.error?.message ?? "");
  check("promotion took — employee holds the child's is_admin role", await holdsRole(admin, empId, childOrg, true));

  // Fresh sign-in so the check runs with the promoted role in place.
  const { client: empAdminClient } = await signInClient(EMP_EMAIL);
  check(
    "child-org admin still reads their OWN private row (positive control)",
    await canRead(empAdminClient, childPrivateRow)
  );
  check(
    "child-org admin does NOT read the parent Org A private row",
    !(await canRead(empAdminClient, privateRow))
  );

  // --- Cleanup (ORDER MATTERS) ------------------------------------------------
  // 1) inventory rows FIRST: inventory_items.owner_id references users with NO
  //    ACTION, so a user who still owns rows cannot be deleted. 2) then the
  //    created employee auth user. 3) then the child org (org deletion cascades
  //    roles/memberships — and would cascade any inventory rows via org_id, but
  //    ours are already gone). Seeded data is left intact.
  await admin.from("inventory_items").delete().in("id", [privateRow, orgRow, childPrivateRow]);
  await admin.auth.admin.deleteUser(empId);
  await admin.from("organizations").delete().eq("id", childOrg);
  console.log("\n(cleaned up: inventory rows → employee → child org; seeded data untouched)\n");

  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(
      "(pre-migration, EXACTLY the two ✱ checks in [4] and [5] are expected to fail; " +
        "any other failure is a real bug)"
    );
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error("VERIFY FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
