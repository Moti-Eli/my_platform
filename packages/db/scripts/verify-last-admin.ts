/**
 * Verification harness for the DB-level "never leave an org with zero admins"
 * guard (migration 20260609000005).
 *
 * Uses the SERVICE-ROLE (secret) key — i.e. a DIRECT PRIVILEGED call that
 * bypasses RLS — to prove the trigger blocks even that. Builds a throwaway org
 * with two admins + one member, then checks:
 *   1. Removing a NON-last admin assignment succeeds.
 *   2. Removing the LAST admin assignment (DELETE) is rejected by the DB.
 *   3. Demoting the last admin (UPDATE role_id) is likewise rejected.
 *   4. After promoting someone else to admin, removing the previous admin works.
 *   5. Deleting the whole org (cascade) still works (the guard is deferred, so it
 *      doesn't block legitimate org teardown).
 *
 * Run:  pnpm --filter @platform/db exec tsx scripts/verify-last-admin.ts
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const rootEnv = resolve(process.cwd(), "../../.env");
dotenv.config({ path: existsSync(rootEnv) ? rootEnv : undefined });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;
if (!URL || !SECRET) throw new Error("Missing Supabase env in root .env");

const ORG_NAME = "LastAdmin Guard Test";
const EMAILS = ["la-admin1@lastadmin.test", "la-admin2@lastadmin.test", "la-member1@lastadmin.test"];

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { passed++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

async function cleanup(admin: SupabaseClient): Promise<void> {
  await admin.from("organizations").delete().eq("name", ORG_NAME);
  const list = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of list.data.users) {
    if (u.email && EMAILS.includes(u.email)) await admin.auth.admin.deleteUser(u.id);
  }
}

async function makeMember(
  admin: SupabaseClient,
  orgId: string,
  email: string,
  roleId: string
): Promise<{ membershipId: string }> {
  const created = await admin.auth.admin.createUser({ email, password: "123456", email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`create ${email}: ${created.error?.message}`);
  const uid = created.data.user.id;
  await admin.from("users").insert({ id: uid, email: created.data.user.email ?? email, display_name: email });
  const mem = await admin
    .from("memberships")
    .insert({ user_id: uid, organization_id: orgId })
    .select("id")
    .single();
  const membershipId = (mem.data as { id: string }).id;
  const mr = await admin
    .from("membership_roles")
    .insert({ membership_id: membershipId, role_id: roleId, organization_id: orgId });
  if (mr.error) throw new Error(`assign role to ${email}: ${mr.error.message}`);
  return { membershipId };
}

async function main(): Promise<void> {
  const admin = createClient(URL!, SECRET!, { auth: { autoRefreshToken: false, persistSession: false } });
  await cleanup(admin);

  // Build the test org: admin + member roles, two admins, one member.
  const org = await admin.from("organizations").insert({ name: ORG_NAME }).select("id").single();
  const orgId = (org.data as { id: string }).id;
  const adminRole = await admin
    .from("roles")
    .insert({ organization_id: orgId, name: "Admin", is_admin: true })
    .select("id")
    .single();
  const adminRoleId = (adminRole.data as { id: string }).id;
  const memberRole = await admin
    .from("roles")
    .insert({ organization_id: orgId, name: "Member", is_admin: false })
    .select("id")
    .single();
  const memberRoleId = (memberRole.data as { id: string }).id;

  const a1 = await makeMember(admin, orgId, EMAILS[0]!, adminRoleId);
  const a2 = await makeMember(admin, orgId, EMAILS[1]!, adminRoleId);
  const m1 = await makeMember(admin, orgId, EMAILS[2]!, memberRoleId);
  console.log(`\nSeeded "${ORG_NAME}" with 2 admins + 1 member.`);

  // [1] Remove a NON-last admin (a2) — org still has a1 as admin -> allowed.
  console.log("\n[1] Remove a non-last admin assignment");
  const del2 = await admin
    .from("membership_roles")
    .delete()
    .eq("membership_id", a2.membershipId)
    .eq("role_id", adminRoleId)
    .eq("organization_id", orgId);
  check("removing a non-last admin succeeds", !del2.error, del2.error?.message ?? "");

  // [2] Remove the LAST admin (a1) via DELETE -> rejected.
  console.log("\n[2] Remove the LAST admin assignment (DELETE)");
  const del1 = await admin
    .from("membership_roles")
    .delete()
    .eq("membership_id", a1.membershipId)
    .eq("role_id", adminRoleId)
    .eq("organization_id", orgId);
  check("DB rejects removing the last admin (DELETE)", !!del1.error, del1.error?.message ?? "");

  // [3] Demote the LAST admin via UPDATE role_id -> rejected.
  console.log("\n[3] Demote the LAST admin (UPDATE role_id admin -> member)");
  const upd = await admin
    .from("membership_roles")
    .update({ role_id: memberRoleId })
    .eq("membership_id", a1.membershipId)
    .eq("role_id", adminRoleId)
    .eq("organization_id", orgId);
  check("DB rejects demoting the last admin (UPDATE)", !!upd.error, upd.error?.message ?? "");

  // [4] Promote the member to admin, THEN remove a1 -> now allowed.
  console.log("\n[4] After promoting another member to admin, removing a1 is allowed");
  const promote = await admin
    .from("membership_roles")
    .insert({ membership_id: m1.membershipId, role_id: adminRoleId, organization_id: orgId });
  check("promote member to admin (insert) succeeds", !promote.error, promote.error?.message ?? "");
  const del1b = await admin
    .from("membership_roles")
    .delete()
    .eq("membership_id", a1.membershipId)
    .eq("role_id", adminRoleId)
    .eq("organization_id", orgId);
  check("removing the former admin now succeeds (another admin exists)", !del1b.error, del1b.error?.message ?? "");

  // [5] Deleting the whole org (which still has an admin) cascades fine.
  console.log("\n[5] Cascade delete of the org is not blocked");
  const delOrg = await admin.from("organizations").delete().eq("id", orgId);
  check("deleting the org (cascade) succeeds despite it having an admin", !delOrg.error, delOrg.error?.message ?? "");

  await cleanup(admin);
  console.log("\n(cleaned up test org + users)\n");
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("VERIFY FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
