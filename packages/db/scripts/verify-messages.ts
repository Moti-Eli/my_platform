/**
 * Verification harness for the internal-chat `messages` table RLS (PART 1).
 *
 * Exercises the real access rules against the REAL Supabase project as real
 * signed-in users (so RLS applies). Requires migration 20260609000002 applied
 * and `pnpm seed` to have been run.
 *
 * Proves:
 *   1. A member can INSERT a message into their org (as themselves) and READ it.
 *   2. Cross-org isolation: that member CANNOT read another org's messages and
 *      CANNOT insert into another org.
 *   3. Anti-forgery: a member cannot insert a message with sender_id set to a
 *      different user.
 *
 * Run:  pnpm --filter @platform/db exec tsx scripts/verify-messages.ts
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const rootEnv = resolve(process.cwd(), "../../.env");
dotenv.config({ path: existsSync(rootEnv) ? rootEnv : undefined });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET = process.env.SUPABASE_SECRET_KEY;
if (!URL || !ANON || !SECRET) throw new Error("Missing Supabase env in root .env");

const PW = "123456";
const MARKER = "[[verify-messages]]"; // tag so cleanup is targeted

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

async function userIdByEmail(admin: SupabaseClient, email: string): Promise<string> {
  const res = await admin.from("users").select("id").eq("email", email).single();
  if (res.error || !res.data) throw new Error(`user ${email}: ${res.error?.message}`);
  return (res.data as { id: string }).id;
}

async function main(): Promise<void> {
  const admin = createClient(URL!, SECRET!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const orgA = await orgIdByName(admin, "Organization A");
  const orgB = await orgIdByName(admin, "Organization B");
  const user2AId = await userIdByEmail(admin, "user2@organizationa.com");
  const orgBSenderId = await userIdByEmail(admin, "user1@organizationb.com");

  // Clean any leftovers, then seed one Org B message (as service_role) so the
  // "cannot read Org B" check is meaningful (there IS a message to be hidden).
  await admin.from("messages").delete().like("content", `%${MARKER}%`);
  const seedB = await admin.from("messages").insert({
    organization_id: orgB,
    sender_id: orgBSenderId,
    content: `Org B secret ${MARKER}`,
  });
  if (seedB.error) throw new Error(`seed Org B message: ${seedB.error.message}`);

  const u1 = await signIn("user1@organizationA.com");

  // --- [1] Member can post into their org (as self) and read it back --------
  console.log("\n[1] Member posts into their own org and reads it");
  const ownContent = `Hello Org A ${MARKER}`;
  const insertA = await u1.client.from("messages").insert({
    organization_id: orgA,
    sender_id: u1.userId,
    content: ownContent,
  });
  check("insert into own org (as self) succeeds", !insertA.error, insertA.error?.message ?? "");

  const readA = await u1.client
    .from("messages")
    .select("content")
    .eq("organization_id", orgA)
    .like("content", `%${MARKER}%`);
  check(
    "can read own org's message",
    !readA.error && (readA.data ?? []).some((m) => (m as { content: string }).content === ownContent)
  );

  // --- [2] Cross-org read isolation -----------------------------------------
  console.log("\n[2] Cross-org isolation (read)");
  const readB = await u1.client
    .from("messages")
    .select("id, content")
    .eq("organization_id", orgB);
  check(
    "CANNOT read Org B's messages (RLS filters them out)",
    !readB.error && (readB.data ?? []).length === 0,
    `rows=${(readB.data ?? []).length}`
  );

  // --- [3] Cross-org insert denied ------------------------------------------
  console.log("\n[3] Cross-org isolation (insert)");
  const insertB = await u1.client.from("messages").insert({
    organization_id: orgB,
    sender_id: u1.userId, // correct self, but wrong org
    content: `Sneaking into B ${MARKER}`,
  });
  check("CANNOT insert into an org they don't belong to", !!insertB.error, insertB.error?.message ?? "");

  // --- [4] Forged sender denied ---------------------------------------------
  console.log("\n[4] Anti-forgery (sender_id must be self)");
  const forged = await u1.client.from("messages").insert({
    organization_id: orgA, // their own org
    sender_id: user2AId, // but pretending to be someone else
    content: `Forged as user2 ${MARKER}`,
  });
  check("CANNOT post with a forged sender_id", !!forged.error, forged.error?.message ?? "");
  // Belt-and-suspenders: confirm no forged row landed.
  const forgedCheck = await admin
    .from("messages")
    .select("id")
    .eq("organization_id", orgA)
    .eq("sender_id", user2AId)
    .like("content", `%${MARKER}%`);
  check("no forged row exists", (forgedCheck.data ?? []).length === 0);

  // --- Cleanup ---------------------------------------------------------------
  await admin.from("messages").delete().like("content", `%${MARKER}%`);
  console.log("\n(cleaned up test messages)\n");

  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error("VERIFY FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
