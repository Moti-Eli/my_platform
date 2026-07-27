/**
 * Verification harness for `leaveOrganizationForCurrentUser` (@platform/auth).
 *
 * "Leave" is the complement of "hide": hide soft-deletes the ORGANIZATION (solo
 * orgs only); leave soft-deletes THE CALLER'S OWN MEMBERSHIP row, so the org
 * survives for everyone else. This harness proves the seam's guards fire with the
 * RIGHT error codes (not merely "some error"), and that a successful leave is a
 * reversible membership soft-delete that leaves role rows physically intact.
 *
 * KEY DESIGN POINT it exercises: the DB last-admin guard
 * (private.enforce_org_keeps_admin, 20260609000005) fires only on membership_roles
 * DELETE/UPDATE. A membership soft-delete never touches membership_roles, so the DB
 * guard CANNOT catch a last admin leaving — the seam enforces `lastAdminMustHandOff`
 * itself, and [4] below is what proves it.
 *
 * Fixtures (all torn down at the end; hard-deleted by cascade):
 *   - "LeaveOrg Main":       admin A + member B (both active) — the happy path.
 *   - "LeaveOrg AdminGuard":  admin AA + member BB (both active) — last-admin guard.
 *   - "LeaveOrg LastOrg":     sole member S, whose ONLY org this is — last-org guard.
 *   - "LeaveOrg Home":        a second active org for A, B and AA (memberships only,
 *                             no roles) so THEIR last-org guard (c) passes and the
 *                             later guards become reachable. S is deliberately NOT
 *                             in it, so S's only org really is the last one.
 *
 * Role assignments respect the escalation guard (20260717000003) exactly like
 * verify-last-admin.ts: the org's FIRST admin assignment is the one bootstrap-exempt
 * service-key insert; every assignment after it runs as a signed-in org admin.
 *
 * Run:  pnpm --filter @platform/db exec tsx scripts/verify-leave-org.ts
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getUserOrganizations, leaveOrganizationForCurrentUser } from "../../auth/src/index";

import { assertLocalDatabase } from "./db-guard";

// FIRST statement: refuse to run against a non-local database. This script WRITES.
// (db-guard loads the root .env itself, so this is safe before dotenv.config below.)
assertLocalDatabase("verify-leave-org.ts");

const rootEnv = resolve(process.cwd(), "../../.env");
dotenv.config({ path: existsSync(rootEnv) ? rootEnv : undefined });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;
// Needed because membership_roles writes run as a signed-in admin (escalation guard).
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!URL || !SECRET || !ANON) throw new Error("Missing Supabase env in root .env");

const PW = "123456";

const ORG_MAIN = "LeaveOrg Main";
const ORG_ADMIN = "LeaveOrg AdminGuard";
const ORG_SOLO = "LeaveOrg LastOrg";
const ORG_HOME = "LeaveOrg Home";
const ORG_NAMES = [ORG_MAIN, ORG_ADMIN, ORG_SOLO, ORG_HOME];

const A = "lo-a@leaveorg.test";
const B = "lo-b@leaveorg.test";
const AA = "lo-aa@leaveorg.test";
const BB = "lo-bb@leaveorg.test";
const S = "lo-solo@leaveorg.test";
const C = "lo-c@leaveorg.test";
const EMAILS = [A, B, AA, BB, S, C];

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
/** Assert a leave result carries EXACTLY the expected error code. */
function checkCode(label: string, result: { error: string | null }, expected: string | null): void {
  check(label, result.error === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(result.error)}`);
}

async function signIn(email: string): Promise<{ client: SupabaseClient; userId: string }> {
  const client = createClient(URL!, ANON!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password: PW });
  if (error || !data.user) throw new Error(`sign in ${email}: ${error?.message ?? "no user"}`);
  return { client, userId: data.user.id };
}

async function makeUser(admin: SupabaseClient, email: string): Promise<string> {
  const created = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`create ${email}: ${created.error?.message}`);
  const uid = created.data.user.id;
  await admin.from("users").insert({ id: uid, email: created.data.user.email ?? email, display_name: email });
  return uid;
}

async function makeMembership(admin: SupabaseClient, orgId: string, uid: string): Promise<string> {
  const mem = await admin
    .from("memberships")
    .insert({ user_id: uid, organization_id: orgId })
    .select("id")
    .single();
  if (mem.error || !mem.data) throw new Error(`membership ${uid}@${orgId}: ${mem.error?.message}`);
  return (mem.data as { id: string }).id;
}

async function makeOrg(
  admin: SupabaseClient,
  name: string
): Promise<{ orgId: string; adminRoleId: string; memberRoleId: string }> {
  const org = await admin.from("organizations").insert({ name }).select("id").single();
  if (org.error || !org.data) throw new Error(`org ${name}: ${org.error?.message}`);
  const orgId = (org.data as { id: string }).id;
  const adminRole = await admin
    .from("roles")
    .insert({ organization_id: orgId, name: "Admin", is_admin: true })
    .select("id")
    .single();
  const memberRole = await admin
    .from("roles")
    .insert({ organization_id: orgId, name: "Member", is_admin: false })
    .select("id")
    .single();
  if (adminRole.error || !adminRole.data || memberRole.error || !memberRole.data) {
    throw new Error(`roles ${name}: ${adminRole.error?.message ?? memberRole.error?.message}`);
  }
  return {
    orgId,
    adminRoleId: (adminRole.data as { id: string }).id,
    memberRoleId: (memberRole.data as { id: string }).id,
  };
}

async function assignRole(
  client: SupabaseClient,
  membershipId: string,
  roleId: string,
  orgId: string,
  who: string
): Promise<void> {
  const mr = await client
    .from("membership_roles")
    .insert({ membership_id: membershipId, role_id: roleId, organization_id: orgId });
  if (mr.error) throw new Error(`assign role (${who}): ${mr.error.message}`);
}

async function cleanup(admin: SupabaseClient): Promise<void> {
  for (const name of ORG_NAMES) await admin.from("organizations").delete().eq("name", name);
  const list = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of list.data.users) {
    if (u.email && EMAILS.includes(u.email)) await admin.auth.admin.deleteUser(u.id);
  }
}

async function main(): Promise<void> {
  const admin = createClient(URL!, SECRET!, { auth: { autoRefreshToken: false, persistSession: false } });
  await cleanup(admin);

  // --- Build fixtures -------------------------------------------------------
  const home = await makeOrg(admin, ORG_HOME);
  const main = await makeOrg(admin, ORG_MAIN);
  const adminOrg = await makeOrg(admin, ORG_ADMIN);
  const solo = await makeOrg(admin, ORG_SOLO);

  const aId = await makeUser(admin, A);
  const bId = await makeUser(admin, B);
  const aaId = await makeUser(admin, AA);
  const bbId = await makeUser(admin, BB);
  const sId = await makeUser(admin, S);
  await makeUser(admin, C); // non-member: exists only to sign in

  // ORG_MAIN: admin A + member B (both active). A's admin role is the org's FIRST
  // assignment (bootstrap-exempt); A then assigns B the Member role as a real admin.
  const aMainMem = await makeMembership(admin, main.orgId, aId);
  const bMainMem = await makeMembership(admin, main.orgId, bId);
  await assignRole(admin, aMainMem, main.adminRoleId, main.orgId, "bootstrap A admin");
  const aClient = (await signIn(A)).client;
  await assignRole(aClient, bMainMem, main.memberRoleId, main.orgId, "A assigns B member");

  // ORG_ADMIN: admin AA + member BB (both active). Same bootstrap pattern.
  const aaMem = await makeMembership(admin, adminOrg.orgId, aaId);
  const bbMem = await makeMembership(admin, adminOrg.orgId, bbId);
  await assignRole(admin, aaMem, adminOrg.adminRoleId, adminOrg.orgId, "bootstrap AA admin");
  const aaClient = (await signIn(AA)).client;
  await assignRole(aaClient, bbMem, adminOrg.memberRoleId, adminOrg.orgId, "AA assigns BB member");

  // ORG_SOLO: sole member S, roleless. This is S's ONLY org (S is not in ORG_HOME).
  await makeMembership(admin, solo.orgId, sId);

  // ORG_HOME: a SECOND active org for A, B and AA (memberships only, no roles) so
  // guard (c) — "not your last org" — passes for each of them, making the later
  // guards reachable. Roles are unnecessary: an active membership alone lists an
  // org in getUserOrganizations.
  await makeMembership(admin, home.orgId, aId);
  await makeMembership(admin, home.orgId, bId);
  await makeMembership(admin, home.orgId, aaId);

  console.log(`\nSeeded ${ORG_NAMES.length} orgs and ${EMAILS.length} users.`);

  // --- [0] NON-VACUITY BASELINE --------------------------------------------
  console.log("\n[0] Baseline: before any leave, both A and B see ORG_MAIN");
  const bClient = (await signIn(B)).client;
  const aOrgs0 = await getUserOrganizations(aClient, aId);
  const bOrgs0 = await getUserOrganizations(bClient, bId);
  check("A sees ORG_MAIN before", aOrgs0.some((o) => o.organizationId === main.orgId));
  check("B sees ORG_MAIN before", bOrgs0.some((o) => o.organizationId === main.orgId));

  // --- [1] B leaves ORG_MAIN (happy path) ----------------------------------
  console.log("\n[1] Member B leaves ORG_MAIN");
  const leaveB = await leaveOrganizationForCurrentUser(bClient, admin, { organizationId: main.orgId });
  checkCode("B's leave returns no error", leaveB, null);

  const bOrgs1 = await getUserOrganizations(bClient, bId);
  check("ORG_MAIN is gone from B's org list", !bOrgs1.some((o) => o.organizationId === main.orgId));
  const aOrgs1 = await getUserOrganizations(aClient, aId);
  check("A still sees ORG_MAIN (org survives for others)", aOrgs1.some((o) => o.organizationId === main.orgId));

  const bMemRow = await admin.from("memberships").select("deleted_at").eq("id", bMainMem).single();
  check(
    "B's membership row has deleted_at set (soft-leave)",
    !!bMemRow.data && !!(bMemRow.data as { deleted_at: string | null }).deleted_at
  );
  const bRoleRows = await admin.from("membership_roles").select("role_id").eq("membership_id", bMainMem);
  check(
    "…but B's membership_roles rows still exist physically (reversible)",
    (bRoleRows.data ?? []).length > 0,
    `roles=${(bRoleRows.data ?? []).length}`
  );

  // --- [2] B leaves ORG_MAIN AGAIN -> notAllowed ---------------------------
  // Guard (b) short-circuits: B no longer has an ACTIVE membership, so the seam
  // rejects at the membership check before reaching guard (e)'s idempotent UPDATE.
  // (leaveFailed from (e) is reachable only via a concurrent double-submit race,
  // which a sequential harness cannot exercise.)
  console.log("\n[2] B leaves ORG_MAIN again (already left)");
  const leaveBAgain = await leaveOrganizationForCurrentUser(bClient, admin, { organizationId: main.orgId });
  checkCode("re-leave is rejected as notAllowed", leaveBAgain, "notAllowed");

  // --- [3] Non-member C tries to leave ORG_MAIN -> notAllowed --------------
  console.log("\n[3] Non-member C tries to leave ORG_MAIN");
  const cClient = (await signIn(C)).client;
  const leaveC = await leaveOrganizationForCurrentUser(cClient, admin, { organizationId: main.orgId });
  checkCode("a non-member's leave is rejected as notAllowed", leaveC, "notAllowed");

  // --- [4] Last active admin AA tries to leave ORG_ADMIN -> handoff --------
  // AA passes guard (c) (they are also in ORG_HOME), so the seam reaches the admin
  // guard: ORG_ADMIN still has active member BB and no other active admin, so AA
  // must hand off first. This is the case the DB guard CANNOT catch.
  console.log("\n[4] Sole active admin AA tries to leave ORG_ADMIN (still has member BB)");
  const leaveAA = await leaveOrganizationForCurrentUser(aaClient, admin, { organizationId: adminOrg.orgId });
  checkCode("last active admin is forced to hand off", leaveAA, "lastAdminMustHandOff");

  // --- [5] Sole-org member S tries to leave ORG_SOLO -> cannotLeaveLastOrg -
  console.log("\n[5] Member S tries to leave their ONLY org");
  const sClient = (await signIn(S)).client;
  const leaveS = await leaveOrganizationForCurrentUser(sClient, admin, { organizationId: solo.orgId });
  checkCode("leaving one's last org is refused", leaveS, "cannotLeaveLastOrg");

  // --- Cleanup --------------------------------------------------------------
  await cleanup(admin);
  console.log("\n(cleaned up test orgs + users)\n");

  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("VERIFY FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
