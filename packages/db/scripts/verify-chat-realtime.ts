/**
 * Realtime tenant-isolation harness for org chat (PART 2, security-critical).
 *
 * Opens THREE live Realtime subscriptions to messages INSERTs and inserts one
 * message into Org A, proving over the actual websocket:
 *   - user1@organizationA.com (Org A)  -> RECEIVES it (sender's own echo)
 *   - admin1@organizationA.com (Org A) -> RECEIVES it (same-org OTHER user = the
 *     live-delivery feature)
 *   - user1@organizationB.com (Org B)  -> RECEIVES NOTHING, even though it
 *     deliberately TAMPERS with the filter to point at Org A. RLS on `messages`
 *     is the boundary, so cross-org messages never reach the socket.
 *
 * Requires migrations through 20260609000003 applied and `pnpm seed` run.
 * Run:  pnpm --filter @platform/db exec tsx scripts/verify-chat-realtime.ts
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { createClient, type SupabaseClient, type RealtimeChannel } from "@supabase/supabase-js";

const rootEnv = resolve(process.cwd(), "../../.env");
dotenv.config({ path: existsSync(rootEnv) ? rootEnv : undefined });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET = process.env.SUPABASE_SECRET_KEY;
if (!URL || !ANON || !SECRET) throw new Error("Missing Supabase env in root .env");

const PW = "123456";
const MARKER = "[[verify-chat-realtime]]";

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { passed++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createClient(URL!, ANON!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password: PW });
  if (error || !data.session) throw new Error(`sign in ${email}: ${error?.message ?? "no session"}`);
  // Ensure the Realtime socket authenticates as this user (so RLS applies to it).
  await client.realtime.setAuth(data.session.access_token);
  return client;
}

async function orgIdByName(admin: SupabaseClient, name: string): Promise<string> {
  const res = await admin.from("organizations").select("id").eq("name", name).single();
  if (res.error || !res.data) throw new Error(`org ${name}: ${res.error?.message}`);
  return (res.data as { id: string }).id;
}

/** Subscribe to messages INSERTs filtered to `orgFilter`; collect received ids. */
function subscribe(
  client: SupabaseClient,
  label: string,
  orgFilter: string,
  received: Set<string>
): Promise<RealtimeChannel> {
  return new Promise((resolveCh, reject) => {
    const channel = client
      .channel(`verify-${label}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `organization_id=eq.${orgFilter}` },
        (payload) => {
          const row = payload.new as { id: string };
          received.add(row.id);
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") resolveCh(channel);
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
          reject(new Error(`${label} subscribe failed: ${status}`));
      });
  });
}

async function main(): Promise<void> {
  const admin = createClient(URL!, SECRET!, { auth: { autoRefreshToken: false, persistSession: false } });
  const orgA = await orgIdByName(admin, "Organization A");
  await admin.from("messages").delete().like("content", `%${MARKER}%`);

  const cA = await signIn("user1@organizationA.com"); // Org A user
  const cA2 = await signIn("admin1@organizationA.com"); // Org A other user
  const cB = await signIn("user1@organizationB.com"); // Org B (eavesdropper)
  const idA = (await cA.auth.getUser()).data.user!.id;
  const idA2 = (await cA2.auth.getUser()).data.user!.id;

  const gotA = new Set<string>();
  const gotA2 = new Set<string>();
  const gotB = new Set<string>();

  console.log("\nSubscribing 3 clients (Org A user, Org A admin, Org B user → all filtered to Org A)...");
  const chA = await subscribe(cA, "orgA-user", orgA, gotA);
  const chA2 = await subscribe(cA2, "orgA-admin", orgA, gotA2);
  // NOTE: the Org B client deliberately filters to Org A to try to eavesdrop.
  const chB = await subscribe(cB, "orgB-eavesdrop", orgA, gotB);
  await sleep(1200); // let subscriptions settle

  async function postAndWait(sender: SupabaseClient, senderId: string, recipient: Set<string>): Promise<string> {
    const ins = await sender
      .from("messages")
      .insert({ organization_id: orgA, sender_id: senderId, content: `live ${MARKER}` })
      .select("id")
      .single();
    if (ins.error || !ins.data) throw new Error(`insert: ${ins.error?.message}`);
    const id = (ins.data as { id: string }).id;
    for (let i = 0; i < 12 && !recipient.has(id); i++) await sleep(500);
    await sleep(1000); // grace so any leak to B would surface
    return id;
  }

  // Message 1: user1@A posts -> the OTHER Org A user (admin1@A) must receive it.
  console.log("\n[1] user1@A posts → admin1@A receives live; Org B does not");
  const m1 = await postAndWait(cA, idA, gotA2);
  check("same-org other user received it live", gotA2.has(m1));
  check("Org B eavesdropper did NOT receive it", !gotB.has(m1));

  // Message 2: admin1@A posts -> user1@A must receive it (symmetric delivery).
  console.log("\n[2] admin1@A posts → user1@A receives live; Org B does not");
  const m2 = await postAndWait(cA2, idA2, gotA);
  check("same-org other user received it live", gotA.has(m2));
  check("Org B eavesdropper did NOT receive it", !gotB.has(m2));

  check(
    "Org B received ZERO Org A messages over the whole run (socket isolation)",
    gotB.size === 0,
    `gotB=${gotB.size}`
  );

  // Cleanup.
  await Promise.all([cA.removeChannel(chA), cA2.removeChannel(chA2), cB.removeChannel(chB)]);
  await admin.from("messages").delete().like("content", `%${MARKER}%`);
  await Promise.all([cA.auth.signOut(), cA2.auth.signOut(), cB.auth.signOut()]);

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("VERIFY FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
