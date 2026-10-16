/**
 * Verification harness for `public.time_entries` (20260723000004) — the FIRST
 * tool table whose rows are BORN 'private'.
 *
 * Exercises the real RLS surface end to end with the seeded fixtures. It
 * proves:
 *
 *   1. The write path works AT ALL: a plain member inserts a row with
 *      visibility 'private' explicitly — no tool has ever written a
 *      born-private row before, so this is the most important check here.
 *   2. The fail-safe default: an insert OMITTING visibility stores 'private'
 *      (service-client read-back), not 'org' — the safe half of the contract.
 *   3. Read isolation: the owner reads their own row (positive control); a
 *      different non-admin member does NOT.
 *   4. Admin read: an Org A admin DOES read the member's row —
 *      auth_user_can_read's admin escape (20260723000003) on a real
 *      born-private table for the first time.
 *   5. The documented write asymmetry: the same admin can NOT update or
 *      delete the row (auth_user_can_write's private branch is owner-only,
 *      deliberately untouched) — paired with the owner updating successfully.
 *   6. Immutability: the owner cannot flip visibility 'private' -> 'org'
 *      (specific trigger error), but CAN still update hours on the same row.
 *   7. The CHECK constraints: hours 0 / 25 / negative are rejected on the
 *      SPECIFIC constraint name; hours 8 and 24 succeed.
 *
 * Run:  pnpm --filter @platform/db run verify:time-entries
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { assertLocalDatabase } from "./db-guard";

// FIRST statement: refuse to run against a non-local database. This script WRITES.
// (db-guard loads the root .env itself, so this is safe before dotenv.config below.)
assertLocalDatabase("verify-time-entries.ts");

const rootEnv = resolve(process.cwd(), "../../.env");
dotenv.config({ path: existsSync(rootEnv) ? rootEnv : undefined });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET = process.env.SUPABASE_SECRET_KEY;
if (!URL || !ANON || !SECRET) throw new Error("Missing Supabase env in root .env");

const TEMP_PASSWORD = "123456";

// time_entries has no name column, so the fixture marker rides in `note` —
// the pre-clean finds leftovers from a failed run by this prefix.
const NOTE_PREFIX = "verify-time-entries:";

// Exact object names from 20260723000004, so failures are asserted on the
// SPECIFIC error, never on a bare `error !== null`.
const HOURS_CHECK = "time_entries_hours_check";
const IMMUTABLE_MSG = "visibility is immutable on public.time_entries";

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

/** Whether a client can read the given time entry (RLS-filtered SELECT by id). */
async function canRead(client: SupabaseClient, rowId: string): Promise<boolean> {
  const res = await client.from("time_entries").select("id").eq("id", rowId);
  if (res.error) throw new Error(`read time entry ${rowId}: ${res.error.message}`);
  return ((res.data ?? []) as Array<{ id: string }>).length === 1;
}

async function main(): Promise<void> {
  const admin = createClient(URL!, SECRET!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const orgA = await orgIdByName(admin, "Organization A");

  // --- Pre-clean: remove leftovers from a previous (possibly failed) run. ----
  // time_entries rows FIRST (owner_id references users with NO ACTION, so a
  // user who still owns rows cannot be deleted); this harness creates NO users,
  // so the row sweep is the whole pre-clean. Seeded data is never deleted.
  await admin.from("time_entries").delete().like("note", `${NOTE_PREFIX}%`);

  const createdRows: string[] = [];

  console.log("\nverify-time-entries — the first BORN-'private' tool table");

  const { client: ownerClient, userId: ownerId } = await signInClient("user1@organizationA.com");

  // --- [1] The write path works at all (explicit visibility: 'private') ------
  console.log("\n[1] A member INSERTS a born-private row (the most important check here)");
  const insExplicit = await ownerClient
    .from("time_entries")
    .insert({
      org_id: orgA,
      owner_id: ownerId,
      visibility: "private",
      hours: 7.5,
      note: `${NOTE_PREFIX} explicit private row`,
    })
    .select("id")
    .single();
  check(
    "insert with visibility: 'private' SUCCEEDS",
    !insExplicit.error && !!insExplicit.data,
    insExplicit.error?.message ?? "",
  );
  if (!insExplicit.data) {
    console.log("\nRESULT: setup failed — cannot continue");
    process.exit(1);
  }
  const privateRow = (insExplicit.data as { id: string }).id;
  createdRows.push(privateRow);

  // --- [2] The fail-safe default: omitted visibility stores 'private' --------
  console.log("\n[2] Omitting visibility stores 'private' (the fail-safe half of the contract)");
  const insDefault = await ownerClient
    .from("time_entries")
    .insert({
      org_id: orgA,
      owner_id: ownerId,
      hours: 4,
      note: `${NOTE_PREFIX} defaulted row`,
    })
    .select("id")
    .single();
  check("insert omitting visibility succeeds", !insDefault.error && !!insDefault.data, insDefault.error?.message ?? "");
  if (insDefault.data) {
    const defaultedRow = (insDefault.data as { id: string }).id;
    createdRows.push(defaultedRow);
    const stored = await admin
      .from("time_entries")
      .select("visibility")
      .eq("id", defaultedRow)
      .single();
    check(
      "stored visibility is 'private', not 'org' (service read-back)",
      !stored.error && (stored.data as { visibility: string } | null)?.visibility === "private",
      `stored = ${JSON.stringify((stored.data as { visibility: string } | null)?.visibility)}`,
    );
  }

  // --- [3] Read isolation ----------------------------------------------------
  console.log("\n[3] Read isolation");
  check("the OWNER reads their own row (positive control)", await canRead(ownerClient, privateRow));
  const { client: otherClient } = await signInClient("user2@organizationA.com");
  check("a different non-admin member does NOT read it", !(await canRead(otherClient, privateRow)));

  // --- [4] Admin read — the escape, on a real born-private table -------------
  console.log("\n[4] Admin read (auth_user_can_read's admin escape)");
  const { client: adminAClient } = await signInClient("admin1@organizationA.com");
  check("an Org A ADMIN reads the member's private row", await canRead(adminAClient, privateRow));

  // --- [5] The documented write asymmetry ------------------------------------
  console.log("\n[5] Admin can READ but not WRITE (can_write's private branch is owner-only)");
  // RLS excludes the row from the admin's UPDATE/DELETE via the policy's
  // USING, so the honest failure shape is ZERO ROWS AFFECTED (no error) — we
  // assert that, print what actually came back, and then confirm server-side
  // that nothing changed.
  const adminUpdate = await adminAClient
    .from("time_entries")
    .update({ hours: 1 })
    .eq("id", privateRow)
    .select("id");
  check(
    "admin UPDATE is rejected (zero rows affected or RLS error)",
    (adminUpdate.data ?? []).length === 0,
    `came back: rows=${(adminUpdate.data ?? []).length}, error=${JSON.stringify(adminUpdate.error?.message ?? null)}`,
  );
  const adminDelete = await adminAClient
    .from("time_entries")
    .delete()
    .eq("id", privateRow)
    .select("id");
  check(
    "admin DELETE is rejected (zero rows affected or RLS error)",
    (adminDelete.data ?? []).length === 0,
    `came back: rows=${(adminDelete.data ?? []).length}, error=${JSON.stringify(adminDelete.error?.message ?? null)}`,
  );
  const afterAdmin = await admin
    .from("time_entries")
    .select("hours")
    .eq("id", privateRow)
    .single();
  check(
    "the row still exists with hours unchanged (service read-back)",
    !afterAdmin.error && Number((afterAdmin.data as { hours: number } | null)?.hours) === 7.5,
    `hours = ${JSON.stringify((afterAdmin.data as { hours: number } | null)?.hours)}`,
  );
  const ownerUpdate = await ownerClient
    .from("time_entries")
    .update({ hours: 6 })
    .eq("id", privateRow)
    .select("id");
  check(
    "positive control: the OWNER updates the same row successfully",
    !ownerUpdate.error && (ownerUpdate.data ?? []).length === 1,
    ownerUpdate.error?.message ?? "",
  );

  // --- [6] Immutability: visibility is frozen after insert -------------------
  console.log("\n[6] Immutability — visibility cannot be flipped 'private' -> 'org'");
  const flip = await ownerClient
    .from("time_entries")
    .update({ visibility: "org" })
    .eq("id", privateRow)
    .select("id");
  check(
    `flip rejected with the SPECIFIC trigger error ("${IMMUTABLE_MSG}…")`,
    flip.error !== null && flip.error.message.includes(IMMUTABLE_MSG),
    `error = ${JSON.stringify(flip.error?.message ?? null)}`,
  );
  const hoursAgain = await ownerClient
    .from("time_entries")
    .update({ hours: 5.5 })
    .eq("id", privateRow)
    .select("id");
  check(
    "positive control: the owner still updates hours on the SAME row",
    !hoursAgain.error && (hoursAgain.data ?? []).length === 1,
    hoursAgain.error?.message ?? "",
  );

  // --- [7] The hours CHECK constraint ----------------------------------------
  console.log("\n[7] CHECK constraint — hours in (0, 24]");
  for (const bad of [0, 25, -3]) {
    const res = await ownerClient.from("time_entries").insert({
      org_id: orgA,
      owner_id: ownerId,
      visibility: "private",
      hours: bad,
      note: `${NOTE_PREFIX} bad hours ${bad}`,
    });
    check(
      `hours = ${bad} rejected on ${HOURS_CHECK}`,
      res.error !== null && res.error.message.includes(HOURS_CHECK),
      `error = ${JSON.stringify(res.error?.message ?? null)}`,
    );
  }
  for (const good of [8, 24]) {
    const res = await ownerClient
      .from("time_entries")
      .insert({
        org_id: orgA,
        owner_id: ownerId,
        visibility: "private",
        hours: good,
        note: `${NOTE_PREFIX} good hours ${good}`,
      })
      .select("id")
      .single();
    check(`hours = ${good} succeeds`, !res.error && !!res.data, res.error?.message ?? "");
    if (res.data) createdRows.push((res.data as { id: string }).id);
  }

  // --- Cleanup (ORDER MATTERS) ----------------------------------------------
  // 1) time_entries rows FIRST: owner_id references users with NO ACTION, so a
  //    user who still owns rows cannot be deleted. 2) then created users —
  //    this harness creates NONE (seeded users only), so the row sweep is the
  //    whole cleanup. Seeded data is left intact.
  if (createdRows.length > 0) await admin.from("time_entries").delete().in("id", createdRows);
  await admin.from("time_entries").delete().like("note", `${NOTE_PREFIX}%`);
  console.log("\n(cleaned up: time_entries rows; no users were created; seeded data untouched)\n");

  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error("VERIFY FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
