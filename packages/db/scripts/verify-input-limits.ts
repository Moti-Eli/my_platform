/**
 * Verification harness for the input-length CHECK constraints (migration
 * 20260610000002, security review M1 / L2).
 *
 * The whole point of M1 is DB-LEVEL enforcement that holds independent of any UI
 * or server action, so we test with the SERVICE-ROLE (secret) key — the most
 * privileged path (bypasses RLS). If the constraints reject bad input even here,
 * they reject it for every caller.
 *
 * Proves, for messages.content / organizations.name / roles.name /
 * users.display_name:
 *   - over-length input is REJECTED,
 *   - empty / whitespace-only input is REJECTED,
 *   - a valid value is ACCEPTED.
 *
 * Fully self-contained: it creates a throwaway org + auth user, exercises the
 * constraints, and cleans everything up (no dependency on `pnpm seed`).
 *
 * Run:  pnpm --filter @platform/db exec tsx scripts/verify-input-limits.ts
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

const TEST_EMAIL = "verify-input-limits@inputlimits.test";

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

/** A check-constraint violation surfaces as Postgres error code 23514. */
function isCheckViolation(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === "23514" || /violates check constraint/i.test(error.message ?? ""));
}

async function main(): Promise<void> {
  const admin: SupabaseClient = createClient(URL!, SECRET!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const long = "x".repeat(5000);
  const longName = "n".repeat(201);

  let orgId: string | null = null;
  let authId: string | null = null;

  try {
    // --- Setup: a throwaway org + auth user (sender for message tests) --------
    const orgRes = await admin
      .from("organizations")
      .insert({ name: "Input Limits Verify Org" })
      .select("id")
      .single();
    if (orgRes.error || !orgRes.data) throw new Error(`setup org: ${orgRes.error?.message}`);
    orgId = (orgRes.data as { id: string }).id;

    const created = await admin.auth.admin.createUser({
      email: TEST_EMAIL,
      password: "123456",
      email_confirm: true,
    });
    if (created.error || !created.data.user) throw new Error(`setup auth user: ${created.error?.message}`);
    authId = created.data.user.id;
    const profile = await admin
      .from("users")
      .insert({ id: authId, email: created.data.user.email ?? TEST_EMAIL, display_name: "Verify User" });
    if (profile.error) throw new Error(`setup profile: ${profile.error.message}`);

    // --- organizations.name ---------------------------------------------------
    console.log("\n[organizations.name] 1..200, non-empty after trim");
    const orgLong = await admin.from("organizations").update({ name: longName }).eq("id", orgId);
    check("over-length org name REJECTED", isCheckViolation(orgLong.error), orgLong.error?.code ?? "no error");
    const orgBlank = await admin.from("organizations").update({ name: "   " }).eq("id", orgId);
    check("whitespace-only org name REJECTED", isCheckViolation(orgBlank.error), orgBlank.error?.code ?? "no error");
    const orgOk = await admin.from("organizations").update({ name: "Renamed Org" }).eq("id", orgId);
    check("valid org name ACCEPTED", !orgOk.error, orgOk.error?.message ?? "");

    // --- roles.name -----------------------------------------------------------
    console.log("\n[roles.name] 1..200, non-empty after trim");
    const roleLong = await admin
      .from("roles")
      .insert({ organization_id: orgId, name: longName, is_admin: false });
    check("over-length role name REJECTED", isCheckViolation(roleLong.error), roleLong.error?.code ?? "no error");
    const roleBlank = await admin
      .from("roles")
      .insert({ organization_id: orgId, name: "  ", is_admin: false });
    check("whitespace-only role name REJECTED", isCheckViolation(roleBlank.error), roleBlank.error?.code ?? "no error");
    const roleOk = await admin
      .from("roles")
      .insert({ organization_id: orgId, name: "Member", is_admin: false });
    check("valid role name ACCEPTED", !roleOk.error, roleOk.error?.message ?? "");

    // --- users.display_name ---------------------------------------------------
    console.log("\n[users.display_name] NULL or 1..200, non-empty after trim");
    const dnLong = await admin.from("users").update({ display_name: longName }).eq("id", authId);
    check("over-length display_name REJECTED", isCheckViolation(dnLong.error), dnLong.error?.code ?? "no error");
    const dnBlank = await admin.from("users").update({ display_name: "   " }).eq("id", authId);
    check("whitespace-only display_name REJECTED", isCheckViolation(dnBlank.error), dnBlank.error?.code ?? "no error");
    const dnNull = await admin.from("users").update({ display_name: null }).eq("id", authId);
    check("NULL display_name ACCEPTED", !dnNull.error, dnNull.error?.message ?? "");
    const dnOk = await admin.from("users").update({ display_name: "Valid Name" }).eq("id", authId);
    check("valid display_name ACCEPTED", !dnOk.error, dnOk.error?.message ?? "");

    // --- messages.content -----------------------------------------------------
    console.log("\n[messages.content] 1..4000, non-empty after trim");
    const msgLong = await admin
      .from("messages")
      .insert({ organization_id: orgId, sender_id: authId, content: long });
    check("over-length content REJECTED", isCheckViolation(msgLong.error), msgLong.error?.code ?? "no error");
    const msgEmpty = await admin
      .from("messages")
      .insert({ organization_id: orgId, sender_id: authId, content: "" });
    check("empty content REJECTED", isCheckViolation(msgEmpty.error), msgEmpty.error?.code ?? "no error");
    const msgBlank = await admin
      .from("messages")
      .insert({ organization_id: orgId, sender_id: authId, content: "   \n\t  " });
    check("whitespace-only content REJECTED", isCheckViolation(msgBlank.error), msgBlank.error?.code ?? "no error");
    const msgOk = await admin
      .from("messages")
      .insert({ organization_id: orgId, sender_id: authId, content: "hello world" });
    check("valid content ACCEPTED", !msgOk.error, msgOk.error?.message ?? "");
  } finally {
    // --- Cleanup (deleting the org cascades roles/messages; deleting the auth
    //     user cascades its profile) ------------------------------------------
    if (orgId) await admin.from("organizations").delete().eq("id", orgId);
    if (authId) await admin.auth.admin.deleteUser(authId);
    console.log("\n(cleaned up throwaway org + auth user)\n");
  }

  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error("VERIFY FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
