/**
 * Verification harness for the PLATFORM-OWNER (super admin) layer.
 *
 * Exercises the real security boundary against the REAL Supabase project, using
 * the SAME @platform/auth functions the app uses. Requires migration
 * 20260609000001 to be applied and `pnpm seed` to have been run (so
 * owner@platform.test exists and is a platform owner).
 *
 * Proves:
 *   1. A platform owner can create a new org + first admin; that admin can log
 *      in and see/manage ONLY their new org (not Org A).
 *   2. A NON-owner (admin1@organizationA.com) is rejected by the server-side
 *      owner check; auth_user_is_platform_owner() is false for them; nothing is
 *      created.
 *   3. Tenant isolation is UNCHANGED: an Org A admin still can't see Org B; a
 *      member still can't write membership_roles.
 *   4. A regular user has NO path to insert themselves into platform_admins
 *      (writes denied; the table is not even readable by clients).
 *
 * Run:  pnpm --filter @platform/db exec tsx scripts/verify-platform-owner.ts
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  createOrganizationWithFirstAdmin,
  isPlatformOwner,
  getUserOrganizations,
  hasPermission,
  getOrganizationMembers,
} from "../../auth/src/index";

const rootEnv = resolve(process.cwd(), "../../.env");
dotenv.config({ path: existsSync(rootEnv) ? rootEnv : undefined });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET = process.env.SUPABASE_SECRET_KEY;
if (!URL || !ANON || !SECRET) throw new Error("Missing Supabase env in root .env");

const PW = "123456";
const OWNER_EMAIL = "owner@platform.test";
const NEW_ORG_NAME = "Verify Test Restaurant";
const NEW_ADMIN_EMAIL = "firstadmin@verifyrestaurant.test";
const FORBIDDEN_ORG_NAME = "Should Not Exist Org";
const FORBIDDEN_ADMIN_EMAIL = "nope@verifyrestaurant.test";

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

async function signIn(email: string): Promise<{ client: SupabaseClient; userId: string }> {
  const client = createClient(URL!, ANON!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password: PW });
  if (error || !data.user) throw new Error(`sign in ${email}: ${error?.message ?? "no user"}`);
  return { client, userId: data.user.id };
}

async function orgIdByName(admin: SupabaseClient, name: string): Promise<string> {
  const res = await admin.from("organizations").select("id").eq("name", name).single();
  if (res.error || !res.data) throw new Error(`org ${name}: ${res.error?.message}`);
  return (res.data as { id: string }).id;
}

async function main(): Promise<void> {
  const admin = createClient(URL!, SECRET!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const orgA = await orgIdByName(admin, "Organization A");
  const orgB = await orgIdByName(admin, "Organization B");

  // Clean any leftovers from a previous run.
  const pre = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of pre.data.users) {
    if (u.email === NEW_ADMIN_EMAIL || u.email === FORBIDDEN_ADMIN_EMAIL) {
      await admin.auth.admin.deleteUser(u.id);
    }
  }
  await admin.from("organizations").delete().in("name", [NEW_ORG_NAME, FORBIDDEN_ORG_NAME]);

  // --- [1] Platform owner creates a new org + first admin --------------------
  console.log("\n[1] Platform owner creates a new org with a first admin");
  const owner = await signIn(OWNER_EMAIL);
  check("owner is recognized as a platform owner", (await isPlatformOwner(owner.client)) === true);

  const result = await createOrganizationWithFirstAdmin(owner.client, admin, {
    organizationName: NEW_ORG_NAME,
    adminEmail: NEW_ADMIN_EMAIL,
    adminDisplayName: "First Admin",
    adminPassword: PW,
  });
  check(
    "owner created org + first admin",
    result.error === null && !!result.organizationId && !!result.adminUserId,
    result.error ?? ""
  );
  const newOrgId = result.organizationId!;

  // The first admin can log in and only sees/manages their new org.
  const newAdmin = await signIn(NEW_ADMIN_EMAIL);
  check("new first-admin can log in with temp password", !!newAdmin.userId);

  const newAdminOrgs = await getUserOrganizations(newAdmin.client, newAdmin.userId);
  check(
    "new admin belongs to exactly their new org",
    newAdminOrgs.length === 1 && newAdminOrgs[0]?.organizationId === newOrgId,
    `orgs=${newAdminOrgs.map((o) => o.organizationName).join(",")}`
  );
  check(
    "new admin has an admin role in the new org",
    newAdminOrgs[0]?.roles.some((r) => r.isAdmin) === true
  );
  check(
    "new admin has members.manage in the new org",
    (await hasPermission(newAdmin.client, newAdmin.userId, newOrgId, "members.manage")) === true
  );
  const newAdminSeesOrgA = await getOrganizationMembers(newAdmin.client, orgA);
  check("new admin CANNOT see Org A's members (isolation)", newAdminSeesOrgA.length === 0);

  // --- [2] A non-owner cannot create an org ----------------------------------
  console.log("\n[2] A non-owner (Org A admin) cannot create an org");
  const orgAAdmin = await signIn("admin1@organizationA.com");
  check(
    "Org A admin is NOT a platform owner",
    (await isPlatformOwner(orgAAdmin.client)) === false
  );
  const denied = await createOrganizationWithFirstAdmin(orgAAdmin.client, admin, {
    organizationName: FORBIDDEN_ORG_NAME,
    adminEmail: FORBIDDEN_ADMIN_EMAIL,
    adminDisplayName: "Nope",
    adminPassword: PW,
  });
  check("non-owner org creation rejected (notAllowed)", denied.error === "notAllowed");
  const leakage = await admin
    .from("organizations")
    .select("id")
    .eq("name", FORBIDDEN_ORG_NAME);
  check(
    "nothing was created by the rejected attempt",
    (leakage.data ?? []).length === 0
  );

  // --- [3] Tenant isolation unchanged ----------------------------------------
  console.log("\n[3] Existing tenant isolation is unchanged");
  const orgAAdminSeesOrgB = await orgAAdmin.client
    .from("memberships")
    .select("id")
    .eq("organization_id", orgB);
  check(
    "Org A admin still cannot see Org B memberships",
    (orgAAdminSeesOrgB.data ?? []).length === 0
  );

  const member = await signIn("user1@organizationA.com");
  // Build a real (membership, admin role) pair in Org A to attempt to write.
  const memMembership = await admin
    .from("memberships")
    .select("id")
    .eq("organization_id", orgA)
    .eq("user_id", member.userId)
    .single();
  const orgAAdminRole = await admin
    .from("roles")
    .select("id")
    .eq("organization_id", orgA)
    .eq("is_admin", true)
    .single();
  const memberWrite = await member.client.from("membership_roles").insert({
    membership_id: (memMembership.data as { id: string }).id,
    role_id: (orgAAdminRole.data as { id: string }).id,
    organization_id: orgA,
  });
  check("a member still cannot write membership_roles (RLS denies)", !!memberWrite.error);

  // --- [4] No self-assignment into platform_admins ---------------------------
  console.log("\n[4] A regular user cannot insert into platform_admins");
  const selfInsert = await orgAAdmin.client
    .from("platform_admins")
    .insert({ user_id: orgAAdmin.userId });
  check("client INSERT into platform_admins denied", !!selfInsert.error, selfInsert.error?.message ?? "");
  const selfRead = await orgAAdmin.client.from("platform_admins").select("user_id");
  check(
    "client cannot read platform_admins (no rows / denied)",
    !!selfRead.error || (selfRead.data ?? []).length === 0
  );
  // And confirm the failed attempts did not somehow grant ownership.
  check(
    "Org A admin is STILL not a platform owner after the attempts",
    (await isPlatformOwner(orgAAdmin.client)) === false
  );

  // --- Cleanup ---------------------------------------------------------------
  if (result.adminUserId) await admin.auth.admin.deleteUser(result.adminUserId);
  await admin.from("organizations").delete().eq("id", newOrgId);
  console.log("\n(cleaned up the created org + first admin)\n");

  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error("VERIFY FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
