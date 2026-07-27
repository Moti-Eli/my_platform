/**
 * Verification harness for `inviteCandidateCore` (the candidate provisioning
 * sequence). LOCAL STACK ONLY.
 *
 * Like verify-child-org.ts, this is NOT part of the app: it imports the SAME core
 * the server intent calls and drives it against the REAL local Supabase with REAL
 * RLS. The core is framework-free precisely so it can be imported here with no Next
 * runtime. It proves, with SPECIFIC outcomes (regexes / exact error keys / counts —
 * never a bare `error !== null`):
 *
 *   a) invite → a /confirm recovery link (nested next → /set-password → questionnaire);
 *      child org under the parent; a real user; answer rows = question-bank count,
 *      all owned by the new user in the child org; EXACTLY ONE questionnaire
 *      app_instances row for that user/org/definition; the candidate record linked.
 *   b) invite AGAIN → NO new org/user, NO second app_instances row, a DIFFERENT
 *      fresh link (idempotent resend).
 *   c) invite on an ARCHIVED candidate → exactly "archived", nothing created.
 *   d) invite where the email is an EXISTING user's → exactly "emailExists", no
 *      orphan child org left behind by the rolled-back provisioning.
 *   e) ROLLBACK PROBE: a deterministic COMMIT-step failure (an rls-client proxy that
 *      forces the (e) candidate-link UPDATE to affect zero rows) AFTER (d) answers +
 *      (d.5) install have SUCCEEDED → exactly "provisionFailed", and NO orphan auth
 *      user / child org / link / app_instances row (the install is created then rolled back).
 *
 * Run:  pnpm --filter @platform/db run verify:invite-candidate
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { inviteCandidateCore } from "../../../apps/cortex/src/tools/candidates/invite-core";
import { QUESTION_BANK } from "../../../apps/cortex/src/tools/candidates/questions";

import { assertLocalDatabase } from "./db-guard";

// FIRST statement: refuse to run against a non-local database. This script WRITES.
assertLocalDatabase("verify-invite-candidate.ts");

const rootEnv = resolve(process.cwd(), "../../.env");
dotenv.config({ path: existsSync(rootEnv) ? rootEnv : undefined });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET = process.env.SUPABASE_SECRET_KEY;
if (!URL || !ANON || !SECRET) throw new Error("Missing Supabase env in root .env");

const BASE_URL = "http://localhost:3000"; // the portal-link origin, injected literally
const PARENT_ORG_NAME = "Organization A"; // seeded parent (P)
const ADMIN_EMAIL = "admin1@organizationA.com"; // seeded admin of P (A) — holds candidates.access via is_admin

// Fixtures created by THIS harness (child org names EQUAL the candidate names).
const CAND_A_NAME = "Rivka Cohen (invite-verify)";
const CAND_A_EMAIL = "rivka.invite-verify@example.com";
const CAND_ARCHIVED_NAME = "Archived Candidate (invite-verify)";
const CAND_ARCHIVED_EMAIL = "archived.invite-verify@example.com";
const CAND_DUP_NAME = "Dup Email Candidate (invite-verify)";
const CAND_DUP_EMAIL = "user1@organizationa.com"; // an EXISTING seeded user's email
const CAND_PROBE_NAME = "Rollback Probe (invite-verify)";
const CAND_PROBE_EMAIL = "probe.invite-verify@example.com";

const CHILD_ORG_NAMES = [CAND_A_NAME, CAND_ARCHIVED_NAME, CAND_DUP_NAME, CAND_PROBE_NAME];
// Emails we created and may delete. NEVER CAND_DUP_EMAIL — that is a seeded user.
const CREATED_EMAILS = [CAND_A_EMAIL, CAND_ARCHIVED_EMAIL, CAND_PROBE_EMAIL];

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

/** Sign in and return an authenticated (RLS-scoped) client for the given user. */
async function signInClient(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(URL!, ANON!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`sign in ${email}: ${error?.message ?? "no user"}`);
  return client;
}

async function orgIdByName(admin: SupabaseClient, name: string): Promise<string> {
  const res = await admin.from("organizations").select("id").eq("name", name).single();
  if (res.error || !res.data) throw new Error(`org ${name}: ${res.error?.message}`);
  return (res.data as { id: string }).id;
}

/** Count child orgs with this exact name under the given parent (service read). */
async function childOrgCount(
  admin: SupabaseClient,
  name: string,
  parentId: string,
): Promise<number> {
  const res = await admin
    .from("organizations")
    .select("id", { count: "exact", head: true })
    .eq("name", name)
    .eq("parent_id", parentId);
  if (res.error) throw new Error(`childOrgCount ${name}: ${res.error.message}`);
  return res.count ?? 0;
}

/** Find an auth user by email (Supabase lowercases emails). Null if none. */
async function findUserByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<{ id: string } | null> {
  const res = await admin.auth.admin.listUsers({ perPage: 1000 });
  const u = res.data.users.find((x) => (x.email ?? "").toLowerCase() === email.toLowerCase());
  return u ? { id: u.id } : null;
}

/** Insert a candidate RECORD as the acting admin (RLS: owner=auth.uid + candidates.access). */
async function insertCandidate(
  actor: SupabaseClient,
  actorId: string,
  orgId: string,
  name: string,
  email: string,
  stage?: string,
): Promise<string> {
  const row: Record<string, unknown> = { org_id: orgId, owner_id: actorId, name, email };
  if (stage) row.stage = stage;
  const res = await actor.from("candidates").insert(row).select("id").single();
  if (res.error || !res.data) throw new Error(`insert candidate ${name}: ${res.error?.message}`);
  return (res.data as { id: string }).id;
}

/** The candidate record's current candidate_user_id (service read). */
async function candidateUserId(admin: SupabaseClient, id: string): Promise<string | null> {
  const res = await admin.from("candidates").select("candidate_user_id").eq("id", id).single();
  if (res.error || !res.data) throw new Error(`read candidate ${id}: ${res.error?.message}`);
  return (res.data as { candidate_user_id: string | null }).candidate_user_id;
}

/** Resolve an app_definitions id by key — also asserts the seed row EXISTS (the
 * invite install step hard-fails without it). */
async function definitionIdByKey(admin: SupabaseClient, key: string): Promise<string> {
  const res = await admin.from("app_definitions").select("id").eq("key", key).maybeSingle();
  if (res.error || !res.data) {
    throw new Error(`app_definitions "${key}" missing — apply the seed (20260727000002)`);
  }
  return (res.data as { id: string }).id;
}

/** app_instances rows for exactly this (owner, org, definition). */
async function instanceCount(
  admin: SupabaseClient,
  ownerId: string,
  orgId: string,
  defId: string,
): Promise<number> {
  const res = await admin
    .from("app_instances")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("org_id", orgId)
    .eq("definition_id", defId);
  if (res.error) throw new Error(`instanceCount: ${res.error.message}`);
  return res.count ?? 0;
}

/** Total app_instances rows for a definition — the invariant the rollback probe
 * checks (unchanged before/after = nothing orphaned). */
async function instanceCountByDefinition(admin: SupabaseClient, defId: string): Promise<number> {
  const res = await admin
    .from("app_instances")
    .select("id", { count: "exact", head: true })
    .eq("definition_id", defId);
  if (res.error) throw new Error(`instanceCountByDefinition: ${res.error.message}`);
  return res.count ?? 0;
}

// The recovery link now nests the onward target as ONE urlencoded `next` param:
// /confirm?token_hash=…&type=recovery&next=<enc("/set-password?next=/tools/questionnaire")>.
const LINK_RE =
  /\/confirm\?token_hash=.+&type=recovery&next=%2Fset-password%3Fnext%3D%2Ftools%2Fquestionnaire/;

async function cleanup(admin: SupabaseClient, parentId: string): Promise<void> {
  // ORDER: child orgs FIRST (org_id ON DELETE CASCADE clears answers + child
  // memberships/roles), THEN the users we created (now unreferenced), THEN the
  // candidate records. Seeded data (parent org, admin, user1) is never touched.
  const orgs = await admin
    .from("organizations")
    .select("id")
    .in("name", CHILD_ORG_NAMES)
    .eq("parent_id", parentId);
  for (const o of (orgs.data ?? []) as Array<{ id: string }>) {
    await admin.from("organizations").delete().eq("id", o.id);
  }
  const users = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of users.data.users) {
    if (CREATED_EMAILS.includes((u.email ?? "").toLowerCase())) {
      await admin.auth.admin.deleteUser(u.id);
    }
  }
  await admin.from("candidates").delete().in("name", CHILD_ORG_NAMES).eq("org_id", parentId);
}

async function main(): Promise<void> {
  const admin = createClient(URL!, SECRET!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const parent = await orgIdByName(admin, PARENT_ORG_NAME);
  // The questionnaire definition the invite install step resolves — also asserts the
  // seed exists before we rely on it.
  const qDefId = await definitionIdByKey(admin, "questionnaire");

  // --- Pre-clean any leftovers from a previous (possibly failed) run. ---------
  console.log("\n[setup] pre-clean + fixtures");
  await cleanup(admin, parent);

  // The recruiter: seeded admin of P. Password is the seed's shared dev password.
  const actor = await signInClient(ADMIN_EMAIL, "123456");
  const actorId = (await actor.auth.getUser()).data.user!.id;

  // Candidate records (owned by the recruiter, in P).
  const candAId = await insertCandidate(actor, actorId, parent, CAND_A_NAME, CAND_A_EMAIL);
  const candArchivedId = await insertCandidate(
    actor,
    actorId,
    parent,
    CAND_ARCHIVED_NAME,
    CAND_ARCHIVED_EMAIL,
    "archived",
  );
  const candDupId = await insertCandidate(actor, actorId, parent, CAND_DUP_NAME, CAND_DUP_EMAIL);
  const candProbeId = await insertCandidate(
    actor,
    actorId,
    parent,
    CAND_PROBE_NAME,
    CAND_PROBE_EMAIL,
  );
  console.log("  fixtures ready (4 candidate records under Organization A)");

  const deps = { rlsDb: actor, serviceDb: admin };

  // --- (a) invite R → full provisioning --------------------------------------
  console.log("\n[a] invite → provisions portal + returns a recovery link");
  const a = await inviteCandidateCore(deps, {
    candidateId: candAId,
    activeOrgId: parent,
    baseUrl: BASE_URL,
  });
  const aOk = !("error" in a);
  check("invite returned a link (no error)", aOk, aOk ? "" : `error=${JSON.stringify((a as { error: string }).error)}`);
  if (!aOk) {
    console.log("\nRESULT: (a) failed — cannot continue");
    await cleanup(admin, parent);
    process.exit(1);
  }
  const aRes = a as { link: string; organizationId?: string; userId?: string };
  check("link matches /confirm?token_hash=…&type=recovery", LINK_RE.test(aRes.link), aRes.link);

  const childId = aRes.organizationId!;
  const newUserId = aRes.userId!;
  const childRow = await admin
    .from("organizations")
    .select("id, parent_id")
    .eq("id", childId)
    .single();
  check(
    "child org exists with parent_id = Organization A",
    !childRow.error && (childRow.data as { parent_id: string | null }).parent_id === parent,
    `parent_id=${(childRow.data as { parent_id: string | null } | null)?.parent_id}`,
  );
  const childNamed = await childOrgCount(admin, CAND_A_NAME, parent);
  check("exactly one child org named after the candidate under P", childNamed === 1, `count=${childNamed}`);

  const userRow = await findUserByEmail(admin, CAND_A_EMAIL);
  check("candidate auth user exists and equals returned userId", !!userRow && userRow.id === newUserId);

  const answers = await admin
    .from("candidate_answers")
    .select("owner_id, org_id, question_key")
    .eq("org_id", childId);
  const answerRows = (answers.data ?? []) as Array<{ owner_id: string; org_id: string; question_key: string }>;
  check(
    `answer rows = question-bank count (${QUESTION_BANK.length})`,
    answerRows.length === QUESTION_BANK.length,
    `got ${answerRows.length}`,
  );
  check("every answer owned by the new candidate user", answerRows.every((r) => r.owner_id === newUserId));
  check("every answer lives in the child org", answerRows.every((r) => r.org_id === childId));
  const bankKeys = new Set(QUESTION_BANK.map((q) => q.key));
  check(
    "answer question_keys match the bank exactly",
    answerRows.length === bankKeys.size && answerRows.every((r) => bankKeys.has(r.question_key)),
  );

  const linkedTo = await candidateUserId(admin, candAId);
  check("candidate record's candidate_user_id = new user", linkedTo === newUserId, `got ${linkedTo}`);

  const instA = await instanceCount(admin, newUserId, childId, qDefId);
  check(
    "exactly one questionnaire app_instances row (new user / child org / questionnaire def)",
    instA === 1,
    `count=${instA}`,
  );

  // --- (b) invite AGAIN → idempotent resend ----------------------------------
  console.log("\n[b] invite again → no new org/user, a DIFFERENT fresh link");
  const orgsBefore = await childOrgCount(admin, CAND_A_NAME, parent);
  const b = await inviteCandidateCore(deps, {
    candidateId: candAId,
    activeOrgId: parent,
    baseUrl: BASE_URL,
  });
  const bOk = !("error" in b);
  check("second invite returned a link (no error)", bOk, bOk ? "" : `error=${JSON.stringify((b as { error: string }).error)}`);
  const bRes = b as { link: string };
  check("second link matches the recovery pattern", bOk && LINK_RE.test(bRes.link));
  check("second link DIFFERS from the first (fresh token)", bOk && bRes.link !== aRes.link);
  const orgsAfter = await childOrgCount(admin, CAND_A_NAME, parent);
  check("no new child org created (count unchanged)", orgsAfter === orgsBefore && orgsAfter === 1, `before=${orgsBefore} after=${orgsAfter}`);
  const instAfterResend = await instanceCount(admin, newUserId, childId, qDefId);
  check("resend created NO second app_instances row (still exactly 1)", instAfterResend === 1, `count=${instAfterResend}`);
  const linkedAfterResend = await candidateUserId(admin, candAId);
  check("candidate_user_id unchanged after resend", linkedAfterResend === newUserId);

  // --- (c) archived candidate → exactly "archived", nothing created ----------
  console.log("\n[c] invite on an archived candidate → 'archived', nothing created");
  const c = await inviteCandidateCore(deps, {
    candidateId: candArchivedId,
    activeOrgId: parent,
    baseUrl: BASE_URL,
  });
  check(
    "returns EXACTLY 'archived'",
    "error" in c && c.error === "archived",
    `got ${JSON.stringify(c)}`,
  );
  check("no child org created for the archived candidate", (await childOrgCount(admin, CAND_ARCHIVED_NAME, parent)) === 0);
  check("no auth user created for the archived candidate", (await findUserByEmail(admin, CAND_ARCHIVED_EMAIL)) === null);
  check("archived candidate still unlinked (candidate_user_id null)", (await candidateUserId(admin, candArchivedId)) === null);

  // --- (d) email already an existing user → exactly "emailExists", no residue -
  console.log("\n[d] invite where email = an EXISTING user → 'emailExists', no orphan org");
  const d = await inviteCandidateCore(deps, {
    candidateId: candDupId,
    activeOrgId: parent,
    baseUrl: BASE_URL,
  });
  check(
    "returns EXACTLY 'emailExists'",
    "error" in d && d.error === "emailExists",
    `got ${JSON.stringify(d)}`,
  );
  check("no orphan child org left by the rolled-back provisioning", (await childOrgCount(admin, CAND_DUP_NAME, parent)) === 0);
  check("dup-email candidate still unlinked (candidate_user_id null)", (await candidateUserId(admin, candDupId)) === null);

  // --- (e) ROLLBACK PROBE: deterministic COMMIT-step failure -----------------
  console.log("\n[e] rollback probe → 'provisionFailed', NO orphan user / org / link / install");
  // An rls-client PROXY over the actor that forces the (e) COMMIT — the
  // `candidates` UPDATE — to affect ZERO rows (the core reads that as an RLS
  // refusal and compensates), while leaving the candidate READ (a) and every
  // createChildOrgWithMember call (memberships/roles/auth) working. The failure lands
  // at (e), AFTER (d) answers AND (d.5) install have SUCCEEDED — so compensation must
  // clean the org (cascading answers + the app_instances row) and the user.
  const probeRlsDb = new Proxy(actor, {
    get(target, prop, receiver) {
      if (prop !== "from") return Reflect.get(target, prop, receiver);
      return (table: string) => {
        const real = target.from(table);
        if (table !== "candidates") return real;
        // Same table for the READ (select→…→maybeSingle) and the COMMIT
        // (update→eq→select): pass the read through; stub ONLY update to zero rows.
        return new Proxy(real, {
          get(rt, p, rc) {
            if (p === "update") {
              return () => ({ eq: () => ({ select: async () => ({ data: [], error: null }) }) });
            }
            const v = Reflect.get(rt, p, rc);
            return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(rt) : v;
          },
        });
      };
    },
  }) as SupabaseClient;

  const instBeforeProbe = await instanceCountByDefinition(admin, qDefId);
  const e = await inviteCandidateCore(
    { rlsDb: probeRlsDb, serviceDb: admin },
    { candidateId: candProbeId, activeOrgId: parent, baseUrl: BASE_URL },
  );
  check(
    "returns EXACTLY 'provisionFailed'",
    "error" in e && e.error === "provisionFailed",
    `got ${JSON.stringify(e)}`,
  );
  check("no orphan auth user (compensation deleted it)", (await findUserByEmail(admin, CAND_PROBE_EMAIL)) === null);
  check("no orphan child org (compensation deleted it)", (await childOrgCount(admin, CAND_PROBE_NAME, parent)) === 0);
  const instAfterProbe = await instanceCountByDefinition(admin, qDefId);
  check(
    "no orphan app_instances (install created then rolled back — total unchanged)",
    instAfterProbe === instBeforeProbe,
    `before=${instBeforeProbe} after=${instAfterProbe}`,
  );
  check("probe candidate never linked (candidate_user_id null)", (await candidateUserId(admin, candProbeId)) === null);

  // --- Cleanup ---------------------------------------------------------------
  await cleanup(admin, parent);
  console.log("\n(cleaned up: child orgs → created users → candidate records; seeded data untouched)");

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error("VERIFY FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
