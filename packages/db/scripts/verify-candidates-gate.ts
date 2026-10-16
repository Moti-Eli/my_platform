/**
 * Verification harness for the `candidates.access` permission gate
 * (migration 20260726000001_candidates_permission_gate).
 *
 * The gate adds `private.auth_user_has_permission(org_id, 'candidates.access')`
 * to ALL FOUR candidates policies (select/insert/update/delete). A plain member
 * (a "teacher") who could previously read and write org-visible candidate rows
 * — because can_write's 'org' branch admits any member of the tree — must now be
 * shut out entirely, while an admin still passes via the `r.is_admin`
 * short-circuit inside auth_user_has_permission (no role_permissions seeding).
 *
 * This exercises the REAL RLS surface end to end, as each user, over the anon
 * key (RLS applies) — never by calling the helper directly. Assertions check
 * SPECIFIC outcomes, not a bare `error !== null`:
 *
 *   A. teacher SELECT on the fixture candidate returns ZERO rows.
 *   B. teacher INSERT is rejected by RLS (WITH CHECK -> 42501 violation);
 *      teacher UPDATE and DELETE affect ZERO rows (USING filters the row out),
 *      each confirmed unchanged/present by a service read-back.
 *   C. admin SELECT returns the row; admin UPDATE succeeds (positive control —
 *      proves the gate is not simply breaking the table for everyone).
 *   D. key-liveness: a temp `gate-test` role linked to candidates.access via
 *      role_permissions, attached to the teacher's membership, makes teacher
 *      SELECT return the row; detaching it returns teacher to zero rows. Proves
 *      the gate is driven by the permission, not by something incidental.
 *
 * NON-VACUITY: run this BEFORE applying the migration and it MUST FAIL on A
 * (the teacher can currently read). D is skipped-as-FAIL pre-migration because
 * the permission key does not exist yet. If A passes pre-migration the harness
 * is not testing anything — stop and fix it.
 *
 * Role assignment obeys the escalation guard (20260717000003): the org's FIRST
 * assignment (the admin's is_admin role) is bootstrap-exempt and goes in via the
 * service key; the LATER gate-test attach/detach must name an entitled actor, so
 * they run over pg with the ADMIN's JWT claims (auth.uid() = admin, who holds an
 * admin role) — the same honest-actor approach as verify-can-write-grant.ts.
 *
 * Env: the usual Supabase vars from the root `.env`, plus SUPABASE_DB_URL.
 * The root `.env` points at the REMOTE project, so override with local values
 * (see running-db-harness notes / db-guard's refusal message):
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<sb_publishable_… from `supabase status`>
 *   SUPABASE_SECRET_KEY=<sb_secret_… from `supabase status`>
 *   SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
 *
 * Run:  pnpm --filter @platform/db run verify:candidates-gate
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";

import { assertLocalDatabase } from "./db-guard";

// FIRST statement: refuse to run against a non-local database. This script WRITES.
// (db-guard loads the root .env itself, so this is safe before dotenv.config below.)
assertLocalDatabase("verify-candidates-gate.ts");

const rootEnv = resolve(process.cwd(), "../../.env");
dotenv.config({ path: existsSync(rootEnv) ? rootEnv : undefined });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET = process.env.SUPABASE_SECRET_KEY;
const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!URL || !ANON || !SECRET) throw new Error("Missing Supabase env in root .env");

const TEMP_PASSWORD = "123456";
const PREFIX = "CandidatesGate Test"; // tags orgs AND candidate rows so cleanup is targeted
const PERMISSION_KEY = "candidates.access";
const EMAILS = {
  admin: "cg-admin@candidatesgate.test",
  teacher: "cg-teacher@candidatesgate.test",
};

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

async function makeOrg(admin: SupabaseClient, name: string): Promise<string> {
  const res = await admin
    .from("organizations")
    .insert({ name: `${PREFIX} — ${name}` })
    .select("id")
    .single();
  if (res.error || !res.data) throw new Error(`create org ${name}: ${res.error?.message}`);
  return (res.data as { id: string }).id;
}

async function makeUser(admin: SupabaseClient, email: string): Promise<string> {
  const created = await admin.auth.admin.createUser({
    email,
    password: TEMP_PASSWORD,
    email_confirm: true,
  });
  if (created.error || !created.data.user) throw new Error(`create ${email}: ${created.error?.message}`);
  const userId = created.data.user.id;
  const prof = await admin
    .from("users")
    .insert({ id: userId, email: created.data.user.email ?? email, display_name: email });
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

async function makeRole(
  admin: SupabaseClient,
  orgId: string,
  name: string,
  isAdmin = false,
): Promise<string> {
  const res = await admin
    .from("roles")
    .insert({ organization_id: orgId, name: `${PREFIX} ${name}`, is_admin: isAdmin })
    .select("id")
    .single();
  if (res.error || !res.data) throw new Error(`create role ${name}: ${res.error?.message}`);
  return (res.data as { id: string }).id;
}

/**
 * The org's FIRST role assignment — bootstrap-exempt from the escalation guard
 * ("nobody can hold a role in an org that has none"), so a plain service-key
 * insert is fine. Any LATER assignment must name an actor: see roleWriteAs.
 */
async function holdRole(
  admin: SupabaseClient,
  membershipId: string,
  roleId: string,
  orgId: string,
): Promise<void> {
  const res = await admin
    .from("membership_roles")
    .insert({ membership_id: membershipId, role_id: roleId, organization_id: orgId });
  if (res.error) throw new Error(`hold role: ${res.error.message}`);
}

/**
 * INSERT or DELETE a membership_roles row with the AUTHORITY OF `actingUserId`,
 * for assignments after an org's first (which the escalation guard requires an
 * entitled actor for). Runs as service_role (bypassing RLS) but WITH the actor's
 * JWT, so auth.uid() resolves and the trigger judges the real actor — here the
 * admin, who holds an is_admin role and may therefore assign/revoke any role.
 * Mirrors verify-can-write-grant.ts's holdRoleAs.
 */
async function roleWriteAs(
  pg: Client,
  op: "insert" | "delete",
  actingUserId: string,
  membershipId: string,
  roleId: string,
  orgId: string,
): Promise<void> {
  await pg.query("begin");
  try {
    await pg.query("set local role service_role");
    await pg.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: actingUserId }),
    ]);
    if (op === "insert") {
      await pg.query(
        "insert into public.membership_roles (membership_id, role_id, organization_id) values ($1,$2,$3)",
        [membershipId, roleId, orgId],
      );
    } else {
      await pg.query(
        "delete from public.membership_roles where membership_id = $1 and role_id = $2",
        [membershipId, roleId],
      );
    }
    await pg.query("commit");
  } catch (err) {
    await pg.query("rollback");
    throw new Error(`${op} role as ${actingUserId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Create an org-visible candidate row via the service key (bypasses RLS — a
 * fixture, not a subject under test). */
async function makeCandidate(
  admin: SupabaseClient,
  orgId: string,
  ownerId: string,
  name: string,
): Promise<string> {
  const res = await admin
    .from("candidates")
    .insert({ org_id: orgId, owner_id: ownerId, name: `${PREFIX} ${name}`, visibility: "org" })
    .select("id")
    .single();
  if (res.error || !res.data) throw new Error(`create candidate ${name}: ${res.error?.message}`);
  return (res.data as { id: string }).id;
}

async function cleanup(admin: SupabaseClient): Promise<void> {
  // Candidates FIRST: owner_id -> users is NO ACTION, so a user who still owns a
  // row cannot be deleted. Then orgs (org_id -> organizations is CASCADE, so this
  // also sweeps memberships/roles/membership_roles and any org-scoped rows). Then
  // the test users by email.
  await admin.from("candidates").delete().like("name", `${PREFIX}%`);
  await admin.from("organizations").delete().like("name", `${PREFIX}%`);
  const list = await admin.auth.admin.listUsers({ perPage: 1000 });
  const emails = Object.values(EMAILS);
  for (const u of list.data.users) {
    if (u.email && emails.includes(u.email)) await admin.auth.admin.deleteUser(u.id);
  }
}

/** Rows of the fixture candidate visible to a client (RLS-filtered SELECT by id). */
async function rowsVisible(client: SupabaseClient, rowId: string): Promise<number> {
  const res = await client.from("candidates").select("id").eq("id", rowId);
  if (res.error) throw new Error(`select candidate ${rowId}: ${res.error.message}`);
  return ((res.data ?? []) as Array<{ id: string }>).length;
}

async function main(): Promise<void> {
  const admin = createClient(URL!, SECRET!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const isLocalDb = /@(localhost|127\.0\.0\.1)[:/]/.test(DB_URL);
  const pg = new Client({ connectionString: DB_URL, ssl: isLocalDb ? undefined : true });
  await pg.connect();

  try {
    await cleanup(admin);

    // --- Fixtures -----------------------------------------------------------
    const org = await makeOrg(admin, "Org");
    const adminUser = await makeUser(admin, EMAILS.admin);
    const teacherUser = await makeUser(admin, EMAILS.teacher);
    const adminMembership = await addMembership(admin, adminUser, org);
    const teacherMembership = await addMembership(admin, teacherUser, org);

    // The admin's is_admin role — the org's FIRST assignment (bootstrap-exempt).
    // The teacher holds NO roles.
    const adminRole = await makeRole(admin, org, "Admin", true);
    await holdRole(admin, adminMembership, adminRole, org);

    // One org-visible candidate (the SELECT/UPDATE subject) + a separate delete
    // target, so a pre-migration teacher DELETE cannot destroy the main row that
    // later assertions read.
    const mainRow = await makeCandidate(admin, org, adminUser, "main row");
    const deleteRow = await makeCandidate(admin, org, adminUser, "delete target");

    console.log(`\nSeeded "${PREFIX}": one org, one admin, one teacher, two org-visible candidates.`);

    const { client: teacher } = await signInClient(EMAILS.teacher);
    const { client: adminClient } = await signInClient(EMAILS.admin);

    // --- [A] teacher SELECT -> zero rows ------------------------------------
    console.log("\n[A] teacher (no roles) SELECT on candidates");
    const aRows = await rowsVisible(teacher, mainRow);
    check("A: teacher SELECT returns ZERO rows", aRows === 0, `rows=${aRows}`);

    // --- [B] teacher writes are rejected ------------------------------------
    console.log("\n[B] teacher INSERT / UPDATE / DELETE are rejected by RLS");
    const ins = await teacher
      .from("candidates")
      .insert({ org_id: org, owner_id: teacherUser, name: `${PREFIX} teacher insert`, visibility: "org" })
      .select("id");
    const insRejected =
      ins.error !== null &&
      (ins.error.code === "42501" || /row-level security/i.test(ins.error.message));
    check(
      "B: teacher INSERT rejected by RLS (WITH CHECK violation)",
      insRejected,
      `rows=${(ins.data ?? []).length}, error=${JSON.stringify(ins.error?.message ?? null)}`,
    );
    // If a pre-migration insert slipped through, remember it for cleanup.
    if ((ins.data ?? []).length > 0) {
      // handled by the prefix sweep in cleanup(); nothing to track explicitly.
    }

    const upd = await teacher
      .from("candidates")
      .update({ role: "teacher-was-here" })
      .eq("id", mainRow)
      .select("id");
    const updRows = (upd.data ?? []).length;
    const mainAfterUpd = await admin.from("candidates").select("role").eq("id", mainRow).single();
    check(
      "B: teacher UPDATE affects ZERO rows (USING filters it out)",
      updRows === 0 && (mainAfterUpd.data as { role: string } | null)?.role !== "teacher-was-here",
      `rows=${updRows}, stored role=${JSON.stringify((mainAfterUpd.data as { role: string } | null)?.role)}, error=${JSON.stringify(upd.error?.message ?? null)}`,
    );

    const del = await teacher.from("candidates").delete().eq("id", deleteRow).select("id");
    const delRows = (del.data ?? []).length;
    const delTargetLives = await admin.from("candidates").select("id").eq("id", deleteRow);
    check(
      "B: teacher DELETE affects ZERO rows (delete target still present)",
      delRows === 0 && (delTargetLives.data ?? []).length === 1,
      `rows=${delRows}, target present=${(delTargetLives.data ?? []).length === 1}, error=${JSON.stringify(del.error?.message ?? null)}`,
    );

    // --- [C] admin positive control -----------------------------------------
    console.log("\n[C] admin passes via the is_admin short-circuit (positive control)");
    check("C: admin SELECT returns the row", (await rowsVisible(adminClient, mainRow)) === 1);
    const adminUpd = await adminClient
      .from("candidates")
      .update({ role: "admin-updated" })
      .eq("id", mainRow)
      .select("id");
    check(
      "C: admin UPDATE succeeds",
      !adminUpd.error && (adminUpd.data ?? []).length === 1,
      adminUpd.error?.message ?? "",
    );

    // --- [D] key-liveness ----------------------------------------------------
    console.log("\n[D] key-liveness — a role bound to candidates.access opens the gate");
    const permRes = await admin
      .from("permissions")
      .select("id")
      .eq("key", PERMISSION_KEY)
      .maybeSingle();
    if (permRes.error) throw new Error(`lookup permission: ${permRes.error.message}`);
    const permId = (permRes.data as { id: string } | null)?.id ?? null;

    if (permId === null) {
      // Pre-migration: the key does not exist yet. Skip D as an explicit FAIL —
      // there is nothing to bind a role to, so liveness cannot be shown.
      check(
        `D: permission '${PERMISSION_KEY}' exists (precondition)`,
        false,
        "key does not exist yet — D skipped (expected pre-migration)",
      );
    } else {
      const gateRole = await makeRole(admin, org, "gate-test");
      const rp = await admin
        .from("role_permissions")
        .insert({ role_id: gateRole, permission_id: permId });
      if (rp.error) throw new Error(`link role_permissions: ${rp.error.message}`);

      // Attach the gate role to the teacher — a non-bootstrap assignment, so it
      // must be done by an entitled actor (the admin) via pg with their JWT.
      await roleWriteAs(pg, "insert", adminUser, teacherMembership, gateRole, org);
      check(
        "D: with the candidates.access role attached, teacher SELECT returns the row",
        (await rowsVisible(teacher, mainRow)) === 1,
        "(permission is computed live from the tables — no re-sign-in needed)",
      );

      // Detach it (still an entitled-actor operation), leaving the role in place
      // so we prove it is the ATTACHMENT, not the role's mere existence, that gates.
      await roleWriteAs(pg, "delete", adminUser, teacherMembership, gateRole, org);
      check(
        "D: after detaching the role, teacher SELECT returns ZERO rows again",
        (await rowsVisible(teacher, mainRow)) === 0,
      );

      // Delete the temp role (cleanup of the D-only fixture).
      const delRole = await admin.from("roles").delete().eq("id", gateRole);
      if (delRole.error) throw new Error(`delete temp role: ${delRole.error.message}`);
    }

    await cleanup(admin);
    console.log("\n(cleaned up test org, users, roles, memberships, candidates)\n");
  } finally {
    await pg.end();
  }

  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error("VERIFY FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
