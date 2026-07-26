/**
 * Verification harness for `public.candidate_answers` (20260727000001).
 *
 * The table has NO candidate-specific policy — its security is GEOGRAPHY. Each
 * answer lives in the candidate's CHILD ORG (org_id), owned by the candidate
 * user (owner_id), and the ordinary org-tree rules (auth_user_can_read /
 * auth_user_can_write) do all the work. This harness proves exactly that, end to
 * end, against the REAL RLS surface.
 *
 * Topology built for the run (all tagged with PREFIX, cleaned up after):
 *
 *     Parent P  ── admin A, plain member M
 *       ├── Child C1 ── candidate U1   (answer row R1)
 *       └── Child C2 ── candidate U2   (answer row R2)
 *
 * Setup/teardown go through the service-role client (bypasses RLS). Every
 * ASSERTION read/write is a DIRECT Postgres call impersonating the user the way
 * the API does (`set local role authenticated` + request.jwt.claims → auth.uid()),
 * so the real policies, the owner-pin WITH CHECK, the unique constraint and the
 * immutability trigger are what get exercised. Each assertion checks a SPECIFIC
 * outcome (exact row count, exact SQLSTATE, exact constraint / trigger message),
 * never a bare `error !== null`.
 *
 * NON-VACUITY: the FIRST thing this harness touches on candidate_answers is the
 * service seed (makeAnswer), which THROWS on error. Against the pre-migration
 * state the relation does not exist, so the harness dies loudly at seed time and
 * no assertion can pass vacuously. The assertions themselves pin exact outcomes,
 * so they cannot pass against a wrong/empty result either.
 *
 * Env: the usual Supabase vars from the root `.env`, plus SUPABASE_DB_URL. The
 * root `.env` points at the REMOTE project, so override with local values (see
 * db-guard's refusal message):
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
 *   SUPABASE_SECRET_KEY=<sb_secret_… from `supabase status`>
 *   SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
 *
 * Run:  pnpm --filter @platform/db run verify:candidate-answers
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";

import { assertLocalDatabase } from "./db-guard";

// FIRST statement: refuse to run against a non-local database. This script WRITES.
// (db-guard loads the root .env itself, so this is safe before dotenv.config below.)
assertLocalDatabase("verify-candidate-answers.ts");

const rootEnv = resolve(process.cwd(), "../../.env");
dotenv.config({ path: existsSync(rootEnv) ? rootEnv : undefined });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;
const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!URL || !SECRET) throw new Error("Missing Supabase env in root .env");

const PREFIX = "CandAnswers Test"; // tag so cleanup is targeted
const UNIQUE_CONSTRAINT = "candidate_answers_org_question_unique";
const EMAILS = {
  admin: "ca-admin@candanswers.test",
  member: "ca-member@candanswers.test",
  cand1: "ca-cand1@candanswers.test",
  cand2: "ca-cand2@candanswers.test",
};

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { passed++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

async function cleanup(admin: SupabaseClient): Promise<void> {
  // parent_id is ON DELETE RESTRICT, so break the child->parent links first.
  // candidate_answers / memberships / roles cascade away with their org.
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

/** Create an auth user + profile + membership in `orgId`; return the user id. */
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

/** Give `userId` an is_admin role in `orgId` (the org's first role — bootstrap-
 * exempt from the escalation guard, so a service insert is fine). */
async function addAdminRole(admin: SupabaseClient, userId: string, orgId: string): Promise<void> {
  const role = await admin
    .from("roles")
    .insert({ organization_id: orgId, name: `${PREFIX} Admin`, is_admin: true })
    .select("id")
    .single();
  if (role.error || !role.data) throw new Error(`create admin role: ${role.error?.message}`);
  const mem = await admin
    .from("memberships")
    .select("id")
    .eq("user_id", userId)
    .eq("organization_id", orgId)
    .single();
  if (mem.error || !mem.data) throw new Error(`membership lookup: ${mem.error?.message}`);
  const link = await admin.from("membership_roles").insert({
    membership_id: (mem.data as { id: string }).id,
    role_id: (role.data as { id: string }).id,
    organization_id: orgId,
  });
  if (link.error) throw new Error(`assign admin role: ${link.error.message}`);
}

/** Seed one answer row via the service client. THROWS loudly on error — this is
 * the harness's first touch of candidate_answers, so a missing relation
 * (pre-migration) aborts the whole run here (non-vacuity). */
async function makeAnswer(
  admin: SupabaseClient,
  orgId: string,
  ownerId: string,
  questionKey: string,
  questionText: string,
): Promise<string> {
  const res = await admin
    .from("candidate_answers")
    .insert({
      org_id: orgId,
      owner_id: ownerId,
      question_key: questionKey,
      question_text: questionText,
      answer: "",
      position: 0,
    })
    .select("id")
    .single();
  if (res.error || !res.data) throw new Error(`seed answer (${questionKey} in ${orgId}): ${res.error?.message}`);
  return (res.data as { id: string }).id;
}

/** Read one answer's `answer` text via the service client (bypasses RLS). */
async function readAnswer(admin: SupabaseClient, id: string): Promise<string | null> {
  const res = await admin.from("candidate_answers").select("answer").eq("id", id).maybeSingle();
  if (res.error) throw new Error(`read-back ${id}: ${res.error.message}`);
  return (res.data as { answer: string } | null)?.answer ?? null;
}

interface ExecResult {
  rowCount: number;
  rows: Array<Record<string, unknown>>;
  error: { code?: string; message: string; constraint?: string } | null;
}

/**
 * Run `sql` as `userId` through RLS, impersonating exactly as the API does. On a
 * database error (RLS violation, constraint, trigger) the transaction is rolled
 * back and the error is RETURNED (code / message / constraint) for the caller to
 * assert on — never thrown. `commit: true` persists a successful write so a
 * service read-back can confirm it; otherwise the statement is rolled back.
 */
async function execAs(
  pg: Client,
  userId: string,
  sql: string,
  params: unknown[],
  opts: { commit?: boolean } = {},
): Promise<ExecResult> {
  await pg.query("begin");
  try {
    await pg.query("set local role authenticated");
    await pg.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId })]);
    let res;
    try {
      res = await pg.query(sql, params);
    } catch (err) {
      await pg.query("rollback");
      const e = err as { code?: string; message: string; constraint?: string };
      return { rowCount: 0, rows: [], error: { code: e.code, message: e.message, constraint: e.constraint } };
    }
    await pg.query(opts.commit ? "commit" : "rollback");
    return { rowCount: res.rowCount ?? 0, rows: (res.rows ?? []) as Array<Record<string, unknown>>, error: null };
  } catch (setupErr) {
    try { await pg.query("rollback"); } catch { /* transaction already aborted */ }
    throw setupErr;
  }
}

const SEL = "select id from public.candidate_answers where id = $1";
const INS =
  "insert into public.candidate_answers (org_id, owner_id, question_key, question_text, answer, position) values ($1,$2,$3,$4,$5,$6)";

async function main(): Promise<void> {
  const admin = createClient(URL!, SECRET!, { auth: { autoRefreshToken: false, persistSession: false } });
  const isLocalDb = /@(localhost|127\.0\.0\.1)[:/]/.test(DB_URL);
  const pg = new Client({ connectionString: DB_URL, ssl: isLocalDb ? undefined : true });
  await pg.connect();

  try {
    await cleanup(admin);

    // --- Topology: Parent P -> Child C1, Child C2 ----------------------------
    const parent = await makeOrg(admin, "Parent", null);
    const child1 = await makeOrg(admin, "Child 1", parent);
    const child2 = await makeOrg(admin, "Child 2", parent);

    const uA = await makeMember(admin, parent, EMAILS.admin);
    await addAdminRole(admin, uA, parent);
    const uM = await makeMember(admin, parent, EMAILS.member);
    const uU1 = await makeMember(admin, child1, EMAILS.cand1);
    const uU2 = await makeMember(admin, child2, EMAILS.cand2);

    // FIRST touch of candidate_answers — dies loudly here if the table is absent.
    const r1 = await makeAnswer(admin, child1, uU1, "intro", "Tell us about yourself");
    const r2 = await makeAnswer(admin, child2, uU2, "intro", "Tell us about yourself");

    console.log(`\nSeeded "${PREFIX}": Parent(admin A, member M) -> C1(U1, R1), C2(U2, R2).`);

    // --- [a] The candidate reads and writes their OWN answers -----------------
    console.log("\n[a] Candidate U1 reads + writes their own answers (C1)");
    const aSel = await execAs(pg, uU1, SEL, [r1]);
    check("U1 SELECTs their C1 answer → VISIBLE (1 row)", aSel.rowCount === 1, `rows=${aSel.rowCount}`);
    const aUpd = await execAs(
      pg, uU1, "update public.candidate_answers set answer = $1 where id = $2", ["U1's own answer", r1],
      { commit: true },
    );
    check("U1 UPDATEs own answer text → 1 row, no error", aUpd.rowCount === 1 && aUpd.error === null,
      `rows=${aUpd.rowCount}, err=${JSON.stringify(aUpd.error?.message ?? null)}`);
    check("...and it PERSISTED (service read-back)", (await readAnswer(admin, r1)) === "U1's own answer",
      `stored=${JSON.stringify(await readAnswer(admin, r1))}`);

    // --- [b] Siblings see nothing of each other -------------------------------
    console.log("\n[b] U1 cannot see or touch the sibling C2's answers");
    const bSel = await execAs(pg, uU1, SEL, [r2]);
    check("U1 SELECTs a C2 answer → ZERO rows", bSel.rowCount === 0, `rows=${bSel.rowCount}`);
    const bUpd = await execAs(
      pg, uU1, "update public.candidate_answers set answer = $1 where id = $2", ["cross-tenant write", r2],
    );
    check("U1 UPDATE against a C2 answer → ZERO rows affected, no error",
      bUpd.rowCount === 0 && bUpd.error === null,
      `rows=${bUpd.rowCount}, err=${JSON.stringify(bUpd.error?.message ?? null)}`);
    check("...and the C2 answer is UNCHANGED (service read-back)", (await readAnswer(admin, r2)) === "",
      `stored=${JSON.stringify(await readAnswer(admin, r2))}`);

    // --- [c] Parent-org members read downward (membership suffices) -----------
    console.log("\n[c] Parent-org members read C1 by downward inheritance");
    check("admin A (member of P) SELECTs the C1 answer → VISIBLE",
      (await execAs(pg, uA, SEL, [r1])).rowCount === 1);
    check("plain member M (member of P, NO roles) SELECTs the C1 answer → VISIBLE " +
      "(the org tree is the privacy boundary — membership suffices, admin-ness not required)",
      (await execAs(pg, uM, SEL, [r1])).rowCount === 1);

    // --- [d] Parent-org member writes downward (tree write rule) --------------
    console.log("\n[d] Admin A writes a C1 answer downward (the tree-write rule as it stands)");
    const dUpd = await execAs(
      pg, uA, "update public.candidate_answers set answer = $1 where id = $2", ["annotated by recruiter A", r1],
      { commit: true },
    );
    check("admin A UPDATEs the C1 answer → 1 row, no error", dUpd.rowCount === 1 && dUpd.error === null,
      `rows=${dUpd.rowCount}, err=${JSON.stringify(dUpd.error?.message ?? null)}`);
    check("...and it PERSISTED (service read-back)",
      (await readAnswer(admin, r1)) === "annotated by recruiter A",
      `stored=${JSON.stringify(await readAnswer(admin, r1))}`);

    // --- [e] Owner is pinned on INSERT ---------------------------------------
    console.log("\n[e] The owner is pinned by the INSERT WITH CHECK");
    const eIns = await execAs(pg, uU1, INS, [child1, uU2, "owner-pin", "Owner pin test", "", 1]);
    check("U1 INSERT with owner_id = U2's id → rejected 42501 (WITH CHECK owner pin)",
      eIns.error?.code === "42501",
      `code=${eIns.error?.code}, msg=${JSON.stringify(eIns.error?.message ?? null)}`);

    // --- [f] Unique (org_id, question_key) ------------------------------------
    console.log("\n[f] Duplicate (org_id, question_key) is rejected");
    const fIns = await execAs(pg, uU1, INS, [child1, uU1, "intro", "duplicate key", "", 2]);
    check(`duplicate INSERT → 23505 on ${UNIQUE_CONSTRAINT}`,
      fIns.error?.code === "23505" && fIns.error?.constraint === UNIQUE_CONSTRAINT,
      `code=${fIns.error?.code}, constraint=${JSON.stringify(fIns.error?.constraint ?? null)}`);

    // --- [g] Immutability trigger freezes visibility / org_id -----------------
    console.log("\n[g] visibility / org_id are immutable after insert");
    const gVis = await execAs(pg, uU1, "update public.candidate_answers set visibility = 'private' where id = $1", [r1]);
    check("UPDATE changing visibility → rejected with the immutability trigger's specific message",
      gVis.error !== null && /visibility is immutable on public\.candidate_answers/.test(gVis.error.message),
      `msg=${JSON.stringify(gVis.error?.message ?? null)}`);
    const gOrg = await execAs(pg, uU1, "update public.candidate_answers set org_id = $1 where id = $2", [child2, r1]);
    check("UPDATE changing org_id → rejected with the immutability trigger's specific message",
      gOrg.error !== null && /org_id is immutable on public\.candidate_answers/.test(gOrg.error.message),
      `msg=${JSON.stringify(gOrg.error?.message ?? null)}`);

    await cleanup(admin);
    console.log("\n(cleaned up test orgs, users, roles, answer rows; seeded data untouched)\n");
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
