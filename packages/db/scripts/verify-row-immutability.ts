/**
 * Verification harness for the tool-row immutability guard (migration
 * 20260716000007): `private.enforce_tool_row_immutability` on `inventory_items`.
 *
 * Proves that visibility / org_id / owner_id cannot CHANGE, that ordinary column
 * updates still work, that re-sending the three columns UNCHANGED is fine (the
 * IS DISTINCT FROM property), and that the delete + re-insert escape hatch works.
 *
 * -----------------------------------------------------------------------------
 * THE service_role HALF IS THE LOAD-BEARING ONE
 * -----------------------------------------------------------------------------
 * `service_role` bypasses RLS but NOT triggers, so it reaches the guard and the
 * guard rejects it. That is the whole point: the shell writes as service_role and
 * is the only write path Cortex has, so a guard that did not bind service_role
 * would bind nothing. Every "must raise" case asserts service_role raises AND that
 * the message names the specific column touched.
 *
 * THE authenticated HALF ASSERTS A DIFFERENT (WEAKER) FACT, ON PURPOSE.
 * `authenticated` never reaches the trigger. It holds the UPDATE table privilege
 * (Supabase's default grants hand it out; our migrations only ever granted SELECT
 * explicitly), but RLS is enabled on inventory_items with a SELECT policy ONLY —
 * no UPDATE policy means no row is updatable, so the statement silently affects
 * ZERO ROWS and raises nothing. Asserting "it raises for authenticated" would be
 * asserting something false about this schema.
 *
 * So the authenticated half asserts the property that is actually true and is the
 * one we care about: THE MUTATION DOES NOT TAKE EFFECT — blocked by RLS strictly
 * EARLIER than the trigger — and records which mechanism blocked it. Written as
 * "raised OR zero rows affected", it keeps holding if a client write policy is
 * ever added (authenticated would then reach the trigger and raise instead), so it
 * does not silently rot into a tautology.
 *
 * Connection approach mirrors verify-can-write-grant.ts: setup/teardown via the
 * service-role client; the mutation attempts run on a direct Postgres connection
 * that impersonates each role, inside rolled-back transactions so no fixture drifts.
 *
 * Env: the usual Supabase vars from the root `.env`, plus SUPABASE_DB_URL.
 * Defaults to the local `supabase start` stack.
 *
 * Run:  pnpm --filter @platform/db exec tsx scripts/verify-row-immutability.ts
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";

import { assertLocalDatabase } from "./db-guard";

// FIRST statement: refuse to run against a non-local database. This script WRITES.
// (db-guard loads the root .env itself, so this is safe before dotenv.config below.)
assertLocalDatabase("verify-row-immutability.ts");

const rootEnv = resolve(process.cwd(), "../../.env");
dotenv.config({ path: existsSync(rootEnv) ? rootEnv : undefined });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;
const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!URL || !SECRET) throw new Error("Missing Supabase env in root .env");

const PREFIX = "RowImmutability Test"; // tag so cleanup is targeted
const EMAILS = {
  c: "ri-c@rowimmutability.test",
  cOther: "ri-c-other@rowimmutability.test",
};

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { passed++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

async function cleanup(admin: SupabaseClient): Promise<void> {
  await admin.from("organizations").update({ parent_id: null }).like("name", `${PREFIX}%`);
  await admin.from("organizations").delete().like("name", `${PREFIX}%`);
  const list = await admin.auth.admin.listUsers({ perPage: 1000 });
  const emails = Object.values(EMAILS);
  for (const u of list.data.users) {
    if (u.email && emails.includes(u.email)) await admin.auth.admin.deleteUser(u.id);
  }
}

async function makeOrg(admin: SupabaseClient, name: string, parentId: string | null): Promise<string> {
  const res = await admin
    .from("organizations")
    .insert({ name: `${PREFIX} — ${name}`, parent_id: parentId })
    .select("id")
    .single();
  if (res.error || !res.data) throw new Error(`create org ${name}: ${res.error?.message}`);
  return (res.data as { id: string }).id;
}

async function makeMember(admin: SupabaseClient, orgId: string, email: string): Promise<string> {
  const created = await admin.auth.admin.createUser({ email, password: "123456", email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`create ${email}: ${created.error?.message}`);
  const userId = created.data.user.id;
  const prof = await admin
    .from("users")
    .insert({ id: userId, email: created.data.user.email ?? email, display_name: email });
  if (prof.error) throw new Error(`profile ${email}: ${prof.error.message}`);
  const mem = await admin.from("memberships").insert({ user_id: userId, organization_id: orgId });
  if (mem.error) throw new Error(`membership ${email}: ${mem.error.message}`);
  return userId;
}

type Visibility = "org" | "private" | "restricted";

async function makeItem(
  admin: SupabaseClient,
  orgId: string,
  ownerId: string,
  name: string,
  visibility: Visibility
): Promise<string> {
  const res = await admin
    .from("inventory_items")
    .insert({ org_id: orgId, owner_id: ownerId, name: `${PREFIX} ${name}`, visibility })
    .select("id")
    .single();
  if (res.error || !res.data) throw new Error(`create item ${name}: ${res.error?.message}`);
  return (res.data as { id: string }).id;
}

// Closed whitelist — patch keys are validated against it, so no caller-supplied
// text ever reaches the SET clause.
const COLS = ["visibility", "org_id", "owner_id", "quantity", "name"] as const;
type Col = (typeof COLS)[number];
type Patch = Partial<Record<Col, string | number>>;

type Actor = "service_role" | "authenticated";
type Outcome = { raised: boolean; msg: string; rows: number };

/**
 * Attempts an UPDATE as `actor`, inside a rolled-back transaction. Returns whether
 * it raised, the message, and how many rows it touched.
 */
async function tryUpdate(
  pg: Client,
  actor: Actor,
  userId: string | null,
  itemId: string,
  patch: Patch
): Promise<Outcome> {
  const keys = Object.keys(patch) as Col[];
  for (const k of keys) {
    if (!COLS.includes(k)) throw new Error(`unwhitelisted column: ${k}`);
  }
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  const vals = keys.map((k) => patch[k] as string | number);

  await pg.query("begin");
  try {
    await pg.query(`set local role ${actor}`);
    if (actor === "authenticated") {
      await pg.query("select set_config('request.jwt.claims', $1, true)", [
        userId === null ? null : JSON.stringify({ sub: userId }),
      ]);
    }
    const res = await pg.query(`update public.inventory_items set ${sets} where id = $1`, [itemId, ...vals]);
    return { raised: false, msg: "", rows: res.rowCount ?? 0 };
  } catch (err: unknown) {
    return { raised: true, msg: err instanceof Error ? err.message : String(err), rows: 0 };
  } finally {
    await pg.query("rollback");
  }
}

async function main(): Promise<void> {
  const admin = createClient(URL!, SECRET!, { auth: { autoRefreshToken: false, persistSession: false } });
  const isLocalDb = /@(localhost|127\.0\.0\.1)[:/]/.test(DB_URL);
  const pg = new Client({ connectionString: DB_URL, ssl: isLocalDb ? undefined : true });
  await pg.connect();

  try {
    await cleanup(admin);

    // HQ -> Branch C, and Branch B as a sibling. Child of C for the child-org case.
    const hq = await makeOrg(admin, "HQ", null);
    const branchC = await makeOrg(admin, "Branch C", hq);
    const branchB = await makeOrg(admin, "Branch B", hq);
    const childOfC = await makeOrg(admin, "Child of C", branchC);

    const uC = await makeMember(admin, branchC, EMAILS.c);
    const uCOther = await makeMember(admin, branchC, EMAILS.cOther);

    const itemOrg = await makeItem(admin, branchC, uC, "org item", "org");
    const itemPrivate = await makeItem(admin, branchC, uC, "private item", "private");
    const itemRestricted = await makeItem(admin, branchC, uC, "restricted item", "restricted");
    console.log(`\nSeeded "${PREFIX}": HQ -> Branch C -> Child of C (+ sibling Branch B), items at each visibility.`);

    // =========================================================================
    // [1] ALLOWED — ordinary updates must still work
    // =========================================================================
    console.log("\n[1] ALLOWED: ordinary column updates still work (service_role)");
    const q = await tryUpdate(pg, "service_role", null, itemOrg, { quantity: 42 });
    check("update quantity succeeds", !q.raised && q.rows === 1, q.raised ? q.msg : `${q.rows} row(s)`);

    const n = await tryUpdate(pg, "service_role", null, itemOrg, { name: `${PREFIX} renamed` });
    check("update name succeeds", !n.raised && n.rows === 1, n.raised ? n.msg : `${n.rows} row(s)`);

    // --- The IS DISTINCT FROM proof -------------------------------------------
    console.log("\n[2] ALLOWED: re-sending the three guarded columns UNCHANGED (the IS DISTINCT FROM proof)");
    const resend = await tryUpdate(pg, "service_role", null, itemOrg, {
      quantity: 7,
      visibility: "org",     // current value
      org_id: branchC,       // current value
      owner_id: uC,          // current value
    });
    check(
      "an update re-sending visibility/org_id/owner_id at their CURRENT values succeeds",
      !resend.raised && resend.rows === 1,
      resend.raised ? resend.msg : `${resend.rows} row(s) — an ORM that re-sends every column is not broken by the guard`
    );

    // --- The escape hatch ------------------------------------------------------
    console.log("\n[3] ALLOWED: the escape hatch — delete + re-insert with a different visibility and org");
    await pg.query("begin");
    let hatchOk = false;
    let hatchMsg = "";
    try {
      await pg.query("set local role service_role");
      await pg.query("delete from public.inventory_items where id = $1", [itemOrg]);
      const ins = await pg.query(
        `insert into public.inventory_items (org_id, owner_id, name, visibility)
         values ($1, $2, $3, $4) returning id, org_id, visibility`,
        [branchB, uC, `${PREFIX} re-homed item`, "restricted"]
      );
      hatchOk = ins.rowCount === 1 && ins.rows[0].visibility === "restricted" && ins.rows[0].org_id === branchB;
      hatchMsg = `re-inserted in a different org with visibility='${ins.rows[0].visibility}'`;
    } catch (err: unknown) {
      hatchMsg = err instanceof Error ? err.message : String(err);
    } finally {
      await pg.query("rollback");
    }
    check("delete + re-insert with a different visibility and org_id succeeds", hatchOk, hatchMsg);

    // =========================================================================
    // [4] MUST NOT CHANGE — the guard, per column
    // =========================================================================
    const cases: { label: string; item: string; patch: Patch; col: string }[] = [
      { label: "visibility 'org' -> 'private'",            item: itemOrg,        patch: { visibility: "private" },    col: "visibility" },
      { label: "visibility 'private' -> 'restricted'",     item: itemPrivate,    patch: { visibility: "restricted" }, col: "visibility" },
      { label: "visibility 'restricted' -> 'org'",         item: itemRestricted, patch: { visibility: "org" },        col: "visibility" },
      { label: "org_id -> a SIBLING org",                  item: itemOrg,        patch: { org_id: branchB },          col: "org_id" },
      { label: "org_id -> a CHILD org",                    item: itemOrg,        patch: { org_id: childOfC },         col: "org_id" },
      { label: "owner_id -> another user",                 item: itemOrg,        patch: { owner_id: uCOther },        col: "owner_id" },
      { label: "quantity AND visibility in one update",    item: itemOrg,        patch: { quantity: 99, visibility: "private" }, col: "visibility" },
    ];

    console.log("\n[4] MUST RAISE as service_role — the load-bearing half (service_role bypasses RLS, NOT triggers)");
    for (const c of cases) {
      const r = await tryUpdate(pg, "service_role", null, c.item, c.patch);
      check(`${c.label} RAISES`, r.raised, r.raised ? "" : `NO ERROR — ${r.rows} row(s) updated`);
      check(
        `...and the message names ${c.col}`,
        r.raised && new RegExp(`${c.col} is immutable`).test(r.msg),
        r.msg.split("\n")[0]
      );
    }

    console.log("\n[5] MUST NOT TAKE EFFECT as authenticated (blocked EARLIER, by RLS — see the header)");
    for (const c of cases) {
      const r = await tryUpdate(pg, "authenticated", uC, c.item, c.patch);
      check(
        `${c.label} does not take effect`,
        r.raised || r.rows === 0,
        r.raised ? `raised: ${r.msg.split("\n")[0]}` : `no raise, ${r.rows} rows affected — RLS has no UPDATE policy, so the trigger is never reached`
      );
    }

    // The org tree is not an exemption: the CHILD-org case above is the one that
    // would sneak through if someone reasoned "it's still inside the tree".
    console.log("\n[6] The org tree is NOT an exemption");
    const child = await tryUpdate(pg, "service_role", null, itemOrg, { org_id: childOfC });
    check(
      "moving a row DOWN into a child org is still rejected",
      child.raised && /org_id is immutable/.test(child.msg),
      "inheritance flows downward for READS; it is not a licence to relocate rows"
    );

    await cleanup(admin);
    console.log("\n(cleaned up test orgs, users, items)\n");
  } finally {
    await pg.end();
  }

  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("VERIFY FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
