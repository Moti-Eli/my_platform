/**
 * Verification harness for "admin can add users to their organization".
 *
 * This is NOT part of the app — it exercises the exact security boundary the
 * server action (`addMemberAction`) relies on, against the REAL Supabase project
 * with REAL RLS, by importing the SAME `hasPermission` from @platform/auth and
 * replicating the action's create + duplicate-detection logic. It proves:
 *
 *   1. An Org A admin IS allowed to add to Org A (hasPermission === true), the
 *      full create flow works, the user appears in the org's member list, and
 *      the new user can log in with the temp password.
 *   2. An Org A MEMBER is rejected by the server-side check (hasPermission ===
 *      false) — so a direct server-action call would be denied.
 *   3. Cross-org is rejected: an Org A admin has no permission in Org B.
 *   4. A duplicate email is detected and surfaced as a friendly error.
 *
 * Run:  pnpm --filter @platform/db exec tsx scripts/verify-add-member.ts
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { hasPermission } from "../../auth/src/index";

const rootEnv = resolve(process.cwd(), "../../.env");
dotenv.config({ path: existsSync(rootEnv) ? rootEnv : undefined });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET = process.env.SUPABASE_SECRET_KEY;
if (!URL || !ANON || !SECRET) throw new Error("Missing Supabase env in root .env");

const TEMP_PASSWORD = "123456";
const NEW_EMAIL = "newhire@organizationa.com";

/** Mirror of the action's duplicate-email heuristic. */
function isDuplicateEmailError(message: string | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return (
    m.includes("already been registered") ||
    m.includes("already registered") ||
    m.includes("already exists") ||
    m.includes("duplicate key") ||
    m.includes("users_email_key") ||
    m.includes("email_exists")
  );
}

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

async function main(): Promise<void> {
  const admin = createClient(URL!, SECRET!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const orgA = await orgIdByName(admin, "Organization A");
  const orgB = await orgIdByName(admin, "Organization B");

  // Ensure a clean slate for the user we create.
  const pre = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of pre.data.users) {
    if (u.email === NEW_EMAIL) await admin.auth.admin.deleteUser(u.id);
  }

  // --- Scenario 1: Org A admin adds a user to Org A ------------------------
  console.log("\n[1] Org A admin adds a user to Org A");
  const { client: adminAClient, userId: adminAId } = await signInClient("admin1@organizationA.com");

  // The server action's gate (re-checked server-side as the acting user):
  const adminAllowedA = await hasPermission(adminAClient, adminAId, orgA, "members.manage");
  check("admin has members.manage in Org A (action would proceed)", adminAllowedA === true);

  // Replicate the action's create sequence (runs only after the gate passes).
  const created = await admin.auth.admin.createUser({
    email: NEW_EMAIL,
    password: TEMP_PASSWORD,
    email_confirm: true,
  });
  check("auth user created", !created.error && !!created.data.user, created.error?.message ?? "");
  const authId = created.data.user!.id;
  await admin.from("users").insert({ id: authId, email: NEW_EMAIL, display_name: "New Hire" });
  const memRes = await admin
    .from("memberships")
    .insert({ user_id: authId, organization_id: orgA })
    .select("id")
    .single();
  const memId = (memRes.data as { id: string }).id;
  const memberRole = await admin
    .from("roles")
    .select("id")
    .eq("organization_id", orgA)
    .eq("is_admin", false)
    .eq("name", "Member")
    .single();
  const mr = await admin.from("membership_roles").insert({
    membership_id: memId,
    role_id: (memberRole.data as { id: string }).id,
    organization_id: orgA,
  });
  check("membership + role assigned", !mr.error, mr.error?.message ?? "");

  // The admin sees the new user in the org's member list (RLS-scoped read).
  const membersRes = await adminAClient.from("memberships").select("user_id").eq("organization_id", orgA);
  const memberUserIds = (membersRes.data ?? []).map((m) => (m as { user_id: string }).user_id);
  check("new user appears in Org A member list", memberUserIds.includes(authId));

  // The new user can log in with the temp password.
  const newLogin = await signInClient(NEW_EMAIL).then(
    () => true,
    () => false
  );
  check("new user can log in with temp password", newLogin);

  // --- Scenario 2: Org A member is rejected by the server-side check -------
  console.log("\n[2] Org A member (no permission) is rejected server-side");
  const { client: memberClient, userId: memberId } = await signInClient("user1@organizationA.com");
  const memberAllowed = await hasPermission(memberClient, memberId, orgA, "members.manage");
  check("member does NOT have members.manage (direct action call denied)", memberAllowed === false);

  // --- Scenario 3: cross-org creation is rejected --------------------------
  console.log("\n[3] Org A admin cannot add to Org B (cross-org)");
  const adminAllowedB = await hasPermission(adminAClient, adminAId, orgB, "members.manage");
  check("Org A admin has NO members.manage in Org B", adminAllowedB === false);

  // --- Scenario 4: duplicate email surfaces a friendly error ---------------
  console.log("\n[4] Duplicate email is detected");
  const dup = await admin.auth.admin.createUser({
    email: "admin2@organizationA.com",
    password: TEMP_PASSWORD,
    email_confirm: true,
  });
  const detected = !!dup.error && isDuplicateEmailError(dup.error.message);
  check("duplicate email detected → 'emailExists' error", detected, dup.error?.message ?? "");

  // --- Cleanup -------------------------------------------------------------
  await admin.auth.admin.deleteUser(authId);
  console.log("\n(cleaned up the created test user)\n");

  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error("VERIFY FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
