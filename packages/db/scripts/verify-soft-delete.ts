/**
 * Verification harness for soft deletes (organizations, memberships, messages).
 *
 * Uses the SERVICE-ROLE key to set `deleted_at` and to inspect that rows persist,
 * and AUTHENTICATED (RLS-scoped) clients to prove soft-deleted rows are hidden
 * from normal reads — without weakening tenant isolation.
 *
 * Proves:
 *   1. A soft-deleted MESSAGE disappears from normal reads, but the row remains.
 *   2. A soft-deleted MEMBERSHIP: the user stops appearing as an active member
 *      and loses access, but the row/roles persist (and restore works).
 *   3. Tenant isolation UNCHANGED (Org A <-> Org B).
 *   4. A soft-deleted ORG: all its data (org/memberships/messages) disappears for
 *      its own member, while the rows persist under the service key.
 *   5. Soft-deleted rows are hidden via the normal client (and anon sees nothing).
 *
 * Run:  pnpm --filter @platform/db exec tsx scripts/verify-soft-delete.ts
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getOrganizationMembers, getUserOrganizations } from "../../auth/src/index";

const rootEnv = resolve(process.cwd(), "../../.env");
dotenv.config({ path: existsSync(rootEnv) ? rootEnv : undefined });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET = process.env.SUPABASE_SECRET_KEY;
if (!URL || !ANON || !SECRET) throw new Error("Missing Supabase env in root .env");

const PW = "123456";
const MARKER = "[[verify-soft-delete]]";
const TMP_ORG = "SoftDelete Test Org";
const TMP_ADMIN = "sd-admin@softdelete.test";

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { passed++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

async function signIn(email: string): Promise<{ client: SupabaseClient; userId: string }> {
  const client = createClient(URL!, ANON!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password: PW });
  if (error || !data.user) throw new Error(`sign in ${email}: ${error?.message ?? "no user"}`);
  return { client, userId: data.user.id };
}

async function orgIdByName(admin: SupabaseClient, name: string): Promise<string> {
  const res = await admin.from("organizations").select("id").eq("name", name).single();
  if (res.error || !res.data) throw new Error(`org ${name}: ${res.error?.message}`);
  return (res.data as { id: string }).id;
}
async function userIdByEmail(admin: SupabaseClient, email: string): Promise<string> {
  const res = await admin.from("users").select("id").eq("email", email).single();
  if (res.error || !res.data) throw new Error(`user ${email}: ${res.error?.message}`);
  return (res.data as { id: string }).id;
}

async function main(): Promise<void> {
  const admin = createClient(URL!, SECRET!, { auth: { autoRefreshToken: false, persistSession: false } });
  const orgA = await orgIdByName(admin, "Organization A");
  const orgB = await orgIdByName(admin, "Organization B");
  const u1Id = await userIdByEmail(admin, "user1@organizationa.com");

  // pre-clean
  await admin.from("messages").delete().like("content", `%${MARKER}%`);
  await admin.from("organizations").delete().eq("name", TMP_ORG);
  for (const u of (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users) {
    if (u.email === TMP_ADMIN) await admin.auth.admin.deleteUser(u.id);
  }

  // --- [1] Soft-deleted message --------------------------------------------
  console.log("\n[1] Soft-deleted message is hidden but the row persists");
  const ins = await admin
    .from("messages")
    .insert({ organization_id: orgA, sender_id: u1Id, content: `hello ${MARKER}` })
    .select("id")
    .single();
  const msgId = (ins.data as { id: string }).id;
  const u1 = await signIn("user1@organizationA.com");
  const before = await u1.client.from("messages").select("id").eq("id", msgId);
  check("active message is visible to a member", (before.data ?? []).length === 1);
  await admin.from("messages").update({ deleted_at: new Date().toISOString() }).eq("id", msgId);
  const after = await u1.client.from("messages").select("id").eq("id", msgId);
  check("soft-deleted message is hidden from normal reads", (after.data ?? []).length === 0);
  const stillThere = await admin.from("messages").select("id, deleted_at").eq("id", msgId).single();
  check("…but the row still exists (service key)", !!stillThere.data && !!(stillThere.data as { deleted_at: string }).deleted_at);

  // --- [2] Soft-deleted membership -----------------------------------------
  console.log("\n[2] Soft-deleted membership: user drops out, row/roles persist, restore works");
  const u3Id = await userIdByEmail(admin, "user3@organizationa.com");
  const memRow = await admin
    .from("memberships")
    .select("id")
    .eq("organization_id", orgA)
    .eq("user_id", u3Id)
    .single();
  const u3MembershipId = (memRow.data as { id: string }).id;
  const admin1 = await signIn("admin1@organizationA.com");
  const membersBefore = await getOrganizationMembers(admin1.client, orgA);
  check("user3 is an active member before", membersBefore.some((m) => m.userId === u3Id));

  await admin.from("memberships").update({ deleted_at: new Date().toISOString() }).eq("id", u3MembershipId);
  const membersAfter = await getOrganizationMembers(admin1.client, orgA);
  check("user3 no longer appears as an active member", !membersAfter.some((m) => m.userId === u3Id));
  const u3 = await signIn("user3@organizationA.com");
  const u3orgs = await getUserOrganizations(u3.client, u3Id);
  check("user3 has lost access to Org A (no orgs)", u3orgs.length === 0, `orgs=${u3orgs.length}`);
  const rolesPersist = await admin.from("membership_roles").select("role_id").eq("membership_id", u3MembershipId);
  check("…but the membership + its roles still exist (service key)", (rolesPersist.data ?? []).length > 0);

  // restore
  await admin.from("memberships").update({ deleted_at: null }).eq("id", u3MembershipId);
  const membersRestored = await getOrganizationMembers(admin1.client, orgA);
  check("restoring deleted_at = null brings user3 back", membersRestored.some((m) => m.userId === u3Id));

  // --- [3] Tenant isolation unchanged --------------------------------------
  console.log("\n[3] Tenant isolation unchanged");
  const aSeesB = await admin1.client.from("memberships").select("id").eq("organization_id", orgB);
  check("Org A admin still cannot see Org B memberships", (aSeesB.data ?? []).length === 0);
  const b1 = await signIn("user1@organizationB.com");
  const bSeesA = await b1.client.from("messages").select("id").eq("organization_id", orgA);
  check("Org B user still cannot see Org A messages", (bSeesA.data ?? []).length === 0);

  // --- [4] Soft-deleted org hides all its data -----------------------------
  console.log("\n[4] Soft-deleted org: all its data disappears for its member, rows persist");
  const tmpOrg = await admin.from("organizations").insert({ name: TMP_ORG }).select("id").single();
  const tmpOrgId = (tmpOrg.data as { id: string }).id;
  const tmpAdminRole = await admin
    .from("roles")
    .insert({ organization_id: tmpOrgId, name: "Admin", is_admin: true })
    .select("id")
    .single();
  const created = await admin.auth.admin.createUser({ email: TMP_ADMIN, password: PW, email_confirm: true });
  const tmpAdminId = created.data.user!.id;
  await admin.from("users").insert({ id: tmpAdminId, email: created.data.user!.email ?? TMP_ADMIN, display_name: "SD Admin" });
  const tmpMem = await admin
    .from("memberships")
    .insert({ user_id: tmpAdminId, organization_id: tmpOrgId })
    .select("id")
    .single();
  await admin.from("membership_roles").insert({
    membership_id: (tmpMem.data as { id: string }).id,
    role_id: (tmpAdminRole.data as { id: string }).id,
    organization_id: tmpOrgId,
  });
  await admin.from("messages").insert({ organization_id: tmpOrgId, sender_id: tmpAdminId, content: `tmp ${MARKER}` });

  const sd = await signIn(TMP_ADMIN);
  const orgsBefore = await getUserOrganizations(sd.client, tmpAdminId);
  check("member sees the org before soft-delete", orgsBefore.some((o) => o.organizationId === tmpOrgId));

  await admin.from("organizations").update({ deleted_at: new Date().toISOString() }).eq("id", tmpOrgId);
  const orgsAfter = await getUserOrganizations(sd.client, tmpAdminId);
  check("org vanishes from the member's org list", !orgsAfter.some((o) => o.organizationId === tmpOrgId));
  const orgRead = await sd.client.from("organizations").select("id").eq("id", tmpOrgId);
  check("org row not readable by its member", (orgRead.data ?? []).length === 0);
  const memRead = await sd.client.from("memberships").select("id").eq("organization_id", tmpOrgId);
  check("its memberships not readable (even own)", (memRead.data ?? []).length === 0);
  const msgRead = await sd.client.from("messages").select("id").eq("organization_id", tmpOrgId);
  check("its messages not readable", (msgRead.data ?? []).length === 0);
  const orgPersists = await admin.from("organizations").select("id, deleted_at").eq("id", tmpOrgId).single();
  check("…but the org row persists (service key)", !!orgPersists.data && !!(orgPersists.data as { deleted_at: string }).deleted_at);

  // --- [5] Hidden for the anon client too ----------------------------------
  console.log("\n[5] anon client sees none of these tables");
  const anon = createClient(URL!, ANON!, { auth: { autoRefreshToken: false, persistSession: false } });
  const anonMsgs = await anon.from("messages").select("id").eq("id", msgId);
  check("anon cannot read messages at all", (anonMsgs.data ?? []).length === 0);

  // --- Cleanup --------------------------------------------------------------
  await admin.from("messages").delete().like("content", `%${MARKER}%`);
  await admin.from("organizations").delete().eq("id", tmpOrgId); // hard delete the throwaway (cascade)
  await admin.auth.admin.deleteUser(tmpAdminId);
  console.log("\n(cleaned up test message, restored user3, hard-deleted throwaway org)\n");

  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("VERIFY FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
