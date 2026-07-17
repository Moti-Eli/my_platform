/**
 * Verification harness for the org-scoped shell audit tables (migration
 * 20260717000002): `events` and `ai_log`.
 *
 * -----------------------------------------------------------------------------
 * THE BUG THIS EXISTS TO PIN DOWN
 * -----------------------------------------------------------------------------
 * events' old policy was `user_id = auth.uid() OR (org_id is not null AND
 * is_member_of(org_id))`. The left branch never re-checked membership, so a user
 * who emitted events in an org and then LEFT kept reading them — payload and all.
 * The load-bearing assertion here is [3]: a departed emitter must NOT read an event
 * whose user_id still matches them. It asserts, as service_role, that the row is
 * still THERE, so a pass means the POLICY blocked rather than the row vanishing.
 *
 * ai_log's policy is a STRICT PREFIX of the intended final rule — org tree AND own
 * rows, with no `audit.view` escape hatch yet (that permission does not exist and
 * must not be invented before step 5 settles the vocabulary). Sections [5] and [6]
 * assert the narrowness explicitly — including that an ORG ADMIN cannot read
 * another user's audit rows — so nobody widens it by accident and calls it a fix.
 * When audit.view lands, [6] is the test that is SUPPOSED to change; until then it
 * is the test that says "not yet".
 *
 * Connection approach mirrors verify-client-grants.ts: setup/teardown through the
 * service-role client, reads through a direct Postgres connection impersonating
 * each user as a real API request does (`set local role authenticated` +
 * `request.jwt.claims`, which is what auth.uid() reads).
 *
 * Env: the usual Supabase vars from the root `.env`, plus SUPABASE_DB_URL.
 * Defaults to the local `supabase start` stack.
 *
 * Run:  pnpm --filter @platform/db exec tsx scripts/verify-shell-audit.ts
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";

const rootEnv = resolve(process.cwd(), "../../.env");
dotenv.config({ path: existsSync(rootEnv) ? rootEnv : undefined });

const SUPA_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const SUPA_KEY = (process.env.SUPABASE_SECRET_KEY ?? "").trim();
const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!SUPA_URL || !SUPA_KEY) throw new Error("Missing Supabase env in root .env");

const PREFIX = "ShellAudit Test";
const EMAILS = {
  hq: "sa-hq@shellaudit.test",
  b: "sa-branch-b@shellaudit.test",
  bAdmin: "sa-branch-b-admin@shellaudit.test",
  leaver: "sa-leaver@shellaudit.test",
  other: "sa-other@shellaudit.test",
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

async function makeUser(admin: SupabaseClient, email: string): Promise<string> {
  const created = await admin.auth.admin.createUser({ email, password: "123456", email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`create ${email}: ${created.error?.message}`);
  const userId = created.data.user.id;
  const prof = await admin.from("users").insert({ id: userId, email, display_name: email });
  if (prof.error) throw new Error(`profile ${email}: ${prof.error.message}`);
  return userId;
}

async function addMembership(admin: SupabaseClient, userId: string, orgId: string): Promise<string> {
  const res = await admin
    .from("memberships")
    .insert({ user_id: userId, organization_id: orgId })
    .select("id")
    .single();
  if (res.error || !res.data) throw new Error(`membership: ${res.error?.message}`);
  return (res.data as { id: string }).id;
}

async function makeEvent(admin: SupabaseClient, orgId: string, userId: string, type: string): Promise<string> {
  const res = await admin
    .from("events")
    .insert({ type: `${PREFIX}.${type}`, org_id: orgId, user_id: userId, payload: { note: `${PREFIX} payload` } })
    .select("id")
    .single();
  if (res.error || !res.data) throw new Error(`create event ${type}: ${res.error?.message}`);
  return (res.data as { id: string }).id;
}

async function makeAiLog(admin: SupabaseClient, orgId: string, userId: string, intent: string): Promise<string> {
  const res = await admin
    .from("ai_log")
    .insert({ org_id: orgId, user_id: userId, intent: `${PREFIX}.${intent}`, input: {}, result: {} })
    .select("id")
    .single();
  if (res.error || !res.data) throw new Error(`create ai_log ${intent}: ${res.error?.message}`);
  return (res.data as { id: string }).id;
}

type Table = "events" | "ai_log";

/**
 * Can `userId` (or anon, when null) SELECT this row through RLS? Impersonates the
 * user the way a real API request does, inside a rolled-back transaction so the
 * `set local` cannot leak into the next call.
 */
async function canRead(pg: Client, userId: string | null, table: Table, rowId: string): Promise<boolean> {
  await pg.query("begin");
  try {
    await pg.query("set local role authenticated");
    await pg.query("select set_config('request.jwt.claims', $1, true)", [
      userId === null ? null : JSON.stringify({ sub: userId }),
    ]);
    // `table` is a closed union of literals from this file — never user input.
    const res = await pg.query(`select 1 from public.${table} where id = $1`, [rowId]);
    return (res.rowCount ?? 0) > 0;
  } finally {
    await pg.query("rollback");
  }
}

async function main(): Promise<void> {
  const admin = createClient(SUPA_URL, SUPA_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const isLocalDb = /@(localhost|127\.0\.0\.1)[:/]/.test(DB_URL);
  const pg = new Client({ connectionString: DB_URL, ssl: isLocalDb ? undefined : true });
  await pg.connect();

  try {
    await cleanup(admin);

    // HQ -> Branch B. Plus Other, an unrelated root.
    const hq = await makeOrg(admin, "HQ", null);
    const branchB = await makeOrg(admin, "Branch B", hq);
    const otherOrg = await makeOrg(admin, "Other", null);

    const uHq = await makeUser(admin, EMAILS.hq);
    const uB = await makeUser(admin, EMAILS.b);
    const uBAdmin = await makeUser(admin, EMAILS.bAdmin);
    const uLeaver = await makeUser(admin, EMAILS.leaver);
    const uOther = await makeUser(admin, EMAILS.other);

    await addMembership(admin, uHq, hq);
    await addMembership(admin, uB, branchB);
    const mBAdmin = await addMembership(admin, uBAdmin, branchB);
    const mLeaver = await addMembership(admin, uLeaver, branchB);
    await addMembership(admin, uOther, otherOrg);

    // A genuine is_admin role holder in Branch B, so "an admin cannot read another
    // user's audit rows" is a real assertion and not a user merely named "admin".
    const roleBAdmin = await admin
      .from("roles")
      .insert({ organization_id: branchB, name: `${PREFIX} B Admin`, is_admin: true })
      .select("id")
      .single();
    if (roleBAdmin.error || !roleBAdmin.data) throw new Error(`role: ${roleBAdmin.error?.message}`);
    const mr = await admin.from("membership_roles").insert({
      membership_id: mBAdmin,
      role_id: (roleBAdmin.data as { id: string }).id,
      organization_id: branchB,
    });
    if (mr.error) throw new Error(`hold admin role: ${mr.error.message}`);

    const evB = await makeEvent(admin, branchB, uB, "branch_event");
    const evHq = await makeEvent(admin, hq, uHq, "hq_event");
    // THE BUG's row: emitted by uLeaver, in branch B. user_id matches them.
    const evLeaver = await makeEvent(admin, branchB, uLeaver, "leaver_event");

    const logB = await makeAiLog(admin, branchB, uB, "own_call");
    const logBAdminSubject = await makeAiLog(admin, branchB, uBAdmin, "admins_own_call");
    const logLeaver = await makeAiLog(admin, branchB, uLeaver, "leaver_call");

    console.log(`\nSeeded "${PREFIX}": HQ -> Branch B (+ unrelated Other), events and ai_log rows at each level.`);

    // =====================================================================
    // events
    // =====================================================================
    console.log("\n[1] events: the org tree reads the org's events, downward only");
    check("member of B reads B's event", await canRead(pg, uB, "events", evB));
    check("HQ member reads B's event (inherits DOWN)", await canRead(pg, uHq, "events", evB));
    check("member of B does NOT read HQ's event (no upward leak)", !(await canRead(pg, uB, "events", evHq)));

    console.log("\n[2] events: outsiders read nothing");
    check("non-member does NOT read B's event", !(await canRead(pg, uOther, "events", evB)));
    check("anon does NOT read B's event", !(await canRead(pg, null, "events", evB)));

    // --- THE BUG ---------------------------------------------------------
    console.log("\n[3] THE BUG: a departed EMITTER must not keep reading their own events");
    check(
      "before leaving: the emitter reads their event",
      await canRead(pg, uLeaver, "events", evLeaver)
    );

    const soft = await admin
      .from("memberships")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", mLeaver);
    if (soft.error) throw new Error(`soft-delete membership: ${soft.error.message}`);

    // Prove the row is still THERE (service_role bypasses RLS): a pass below must
    // mean the POLICY blocked, not that the row disappeared.
    const stillThere = await admin.from("events").select("id, user_id").eq("id", evLeaver).single();
    check(
      "the event row SURVIVES the membership soft-delete",
      !stillThere.error && stillThere.data?.id === evLeaver,
      `user_id still = the leaver: ${stillThere.data?.user_id === uLeaver}`
    );
    check(
      "=> after leaving, the emitter does NOT read it (user_id is no longer a grant)",
      !(await canRead(pg, uLeaver, "events", evLeaver)),
      "the OR branch is gone; membership blocks"
    );
    check(
      "...while a CURRENT member of B still reads that same event",
      await canRead(pg, uB, "events", evLeaver),
      "proves the row is readable in principle — only the leaver lost it"
    );

    // --- org_id is mandatory ---------------------------------------------
    console.log("\n[4] events.org_id is NOT NULL");
    const evNoOrg = await admin
      .from("events")
      .insert({ type: `${PREFIX}.orphan`, user_id: uB, payload: {} });
    check("inserting an event with NULL org_id is REJECTED", !!evNoOrg.error, evNoOrg.error?.message ?? "NO ERROR");

    // =====================================================================
    // ai_log
    // =====================================================================
    console.log("\n[5] ai_log: your own rows, in an org you belong to");
    check("user reads their OWN ai_log row in their org", await canRead(pg, uB, "ai_log", logB));
    check("non-member does NOT read", !(await canRead(pg, uOther, "ai_log", logB)));
    check("anon does NOT read", !(await canRead(pg, null, "ai_log", logB)));

    console.log("\n[6] ai_log: the rule is a STRICT PREFIX — nobody reads anyone else's rows YET");
    check(
      "a fellow member does NOT read another user's ai_log row",
      !(await canRead(pg, uB, "ai_log", logBAdminSubject)),
      "narrow on purpose"
    );
    check(
      "an ADMIN of the org does NOT read another user's ai_log row either",
      !(await canRead(pg, uBAdmin, "ai_log", logB)),
      "audit.view does not exist yet — it must not be invented before step 5"
    );
    check(
      "an HQ (parent-org) member does NOT read a B user's ai_log row",
      !(await canRead(pg, uHq, "ai_log", logB)),
      "tree membership alone is not enough; the AND still requires user_id"
    );

    console.log("\n[7] ai_log: leaving the org costs you even your OWN audit rows");
    check(
      "the leaver's ai_log row SURVIVES (org keeps the record)",
      !(await admin.from("ai_log").select("id").eq("id", logLeaver).single()).error
    );
    check(
      "a user with a soft-deleted membership does NOT read their own ai_log row",
      !(await canRead(pg, uLeaver, "ai_log", logLeaver)),
      "the org retains the record; the person loses access"
    );

    console.log("\n[8] ai_log.org_id is NOT NULL");
    const logNoOrg = await admin
      .from("ai_log")
      .insert({ user_id: uB, intent: `${PREFIX}.orphan`, input: {} });
    check("inserting an ai_log row with NULL org_id is REJECTED", !!logNoOrg.error, logNoOrg.error?.message ?? "NO ERROR");

    // =====================================================================
    // grants (the same tightening the other Cortex tables got)
    // =====================================================================
    console.log("\n[9] Grants on events / ai_log match the Cortex tightening");
    for (const t of ["events", "ai_log"] as const) {
      const anonP = await pg.query(
        `select privilege_type from information_schema.role_table_grants
          where table_schema='public' and table_name=$1 and grantee='anon'`,
        [t]
      );
      check(`anon holds NO privileges on ${t}`, (anonP.rowCount ?? 0) === 0,
        anonP.rows.map((r) => r.privilege_type).join(",") || "(none)");

      const authP = await pg.query(
        `select privilege_type from information_schema.role_table_grants
          where table_schema='public' and table_name=$1 and grantee='authenticated'`,
        [t]
      );
      const auth = new Set(authP.rows.map((r) => r.privilege_type as string));
      check(`authenticated has SELECT on ${t}`, auth.has("SELECT"), [...auth].sort().join(",") || "(none)");
      check(
        `authenticated has NO insert/update/delete on ${t}`,
        !auth.has("INSERT") && !auth.has("UPDATE") && !auth.has("DELETE"),
        [...auth].sort().join(",") || "(none)"
      );

      const svcP = await pg.query(
        `select privilege_type from information_schema.role_table_grants
          where table_schema='public' and table_name=$1 and grantee='service_role'`,
        [t]
      );
      const svc = new Set(svcP.rows.map((r) => r.privilege_type as string));
      check(
        `service_role can still write to ${t}`,
        svc.has("INSERT") && svc.has("UPDATE") && svc.has("DELETE"),
        "the data-layer appends every event and audit row"
      );
    }

    await cleanup(admin);
    console.log("\n(cleaned up test orgs, users, events, ai_log rows)\n");
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
