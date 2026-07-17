/**
 * Verification harness for the role-assignment escalation guard (migration
 * 20260717000003): `private.auth_user_may_assign_role` + the
 * `membership_roles_no_escalation` BEFORE ROW trigger. Also pins the deletion of
 * the dead `users.view` permission.
 *
 * -----------------------------------------------------------------------------
 * THE HOLE THIS EXISTS TO CLOSE
 * -----------------------------------------------------------------------------
 * 20260608000003 gated membership_roles writes on `members.manage` and recorded
 * the assumption that made that safe: "'members.manage' is currently granted ONLY
 * to admin roles ... IF it is ever granted to a non-admin role, that role could
 * grant the Admin role to anyone (including itself)". Roles are org-owned DATA,
 * editable by admins — so that assumption expires the day someone grants
 * members.manage to a non-admin role, with no schema change to review.
 *
 * This harness therefore builds EXACTLY that org: a non-admin role "HR" that
 * holds members.manage, held by a manager who is not an admin. Every RAISE in
 * section [2] is an escalation that WAS possible before this migration. The
 * headline is [2c]: the manager assigning themselves an admin role. [2e] is the
 * indirect path a `members.manage_admins` permission split would have missed
 * entirely — granting themselves a role that holds `roles.manage` lets them edit
 * any role's permissions, which is escalation without ever touching is_admin.
 *
 * ON ORDER (asserted, not assumed): a BEFORE ROW trigger fires BEFORE the RLS
 * WITH CHECK is evaluated. So a caller who lacks members.manage hits the
 * TRIGGER's error, not a policy violation. Both deny; section [5] asserts which
 * mechanism actually fired by matching the error text, so the distinction is
 * pinned rather than assumed.
 *
 * ON CASCADES: the guard covers DELETE, which means it sees the membership_roles
 * rows that `delete from organizations` / deleting a user / deleting a role
 * cascade away. Section [4] proves those still work (they are exempt: the parent
 * is already gone) while a DIRECT delete of a live row still raises. Without that
 * exemption orgs and users would be undeletable by anyone, including service_role.
 *
 * Connection approach mirrors verify-shell-audit.ts: setup/teardown through the
 * service-role client, writes through a direct Postgres connection impersonating
 * each user as a real API request does (`set local role authenticated` +
 * `request.jwt.claims`, which is what auth.uid() reads).
 *
 * Env: the usual Supabase vars from the root `.env`, plus SUPABASE_DB_URL.
 * Defaults to the local `supabase start` stack.
 *
 * Run:  pnpm --filter @platform/db exec tsx scripts/verify-role-escalation.ts
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";

import { assertLocalDatabase } from "./db-guard";

// FIRST statement: refuse to run against a non-local database. This script WRITES.
// (db-guard loads the root .env itself, so this is safe before dotenv.config below.)
assertLocalDatabase("verify-role-escalation.ts");

const rootEnv = resolve(process.cwd(), "../../.env");
dotenv.config({ path: existsSync(rootEnv) ? rootEnv : undefined });

const SUPA_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const SUPA_KEY = (process.env.SUPABASE_SECRET_KEY ?? "").trim();
const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!SUPA_URL || !SUPA_KEY) throw new Error("Missing Supabase env in root .env");

const PREFIX = "RoleEsc Test";
const EMAILS = {
  admin: "re-admin@roleesc.test",
  manager: "re-manager@roleesc.test",
  target: "re-target@roleesc.test",
  bystander: "re-bystander@roleesc.test",
  cascade: "re-cascade@roleesc.test",
};

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { passed++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

/** The guard's own error text — used to prove WHICH mechanism denied a write. */
const TRIGGER_ERROR = /Not allowed to (assign|revoke) the role/;
const RLS_ERROR = /row-level security|violates row-level security policy/i;

async function cleanup(admin: SupabaseClient): Promise<void> {
  await admin.from("organizations").delete().like("name", `${PREFIX}%`);
  const list = await admin.auth.admin.listUsers({ perPage: 1000 });
  const emails = Object.values(EMAILS);
  for (const u of list.data.users) {
    if (u.email && emails.includes(u.email)) await admin.auth.admin.deleteUser(u.id);
  }
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

async function makeRole(
  admin: SupabaseClient,
  orgId: string,
  name: string,
  isAdmin: boolean,
  permissionKeys: string[] = []
): Promise<string> {
  const res = await admin
    .from("roles")
    .insert({ organization_id: orgId, name, is_admin: isAdmin })
    .select("id")
    .single();
  if (res.error || !res.data) throw new Error(`create role ${name}: ${res.error?.message}`);
  const roleId = (res.data as { id: string }).id;
  for (const key of permissionKeys) {
    const perm = await admin.from("permissions").select("id").eq("key", key).single();
    if (perm.error || !perm.data) throw new Error(`permission ${key}: ${perm.error?.message}`);
    const rp = await admin
      .from("role_permissions")
      .insert({ role_id: roleId, permission_id: (perm.data as { id: string }).id });
    if (rp.error) throw new Error(`grant ${key} to ${name}: ${rp.error.message}`);
  }
  return roleId;
}

type Outcome = { ok: boolean; message: string };

/**
 * Attempt a write as `userId` (or with NO JWT when null), in the given role.
 * Rolled back either way, so assertions never depend on each other's leftovers.
 * `set local` cannot leak past the rollback.
 */
async function attempt(
  pg: Client,
  as: { role: "authenticated" | "service_role"; userId: string | null },
  sql: string,
  params: unknown[]
): Promise<Outcome> {
  await pg.query("begin");
  try {
    await pg.query(`set local role ${as.role}`);
    await pg.query("select set_config('request.jwt.claims', $1, true)", [
      as.userId === null ? null : JSON.stringify({ sub: as.userId, role: as.role }),
    ]);
    await pg.query(sql, params);
    await pg.query("rollback");
    return { ok: true, message: "" };
  } catch (err) {
    await pg.query("rollback");
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

const assign = (pg: Client, as: Parameters<typeof attempt>[1], m: string, r: string, o: string) =>
  attempt(pg, as, "insert into public.membership_roles (membership_id, role_id, organization_id) values ($1,$2,$3)", [m, r, o]);

const revoke = (pg: Client, as: Parameters<typeof attempt>[1], m: string, r: string) =>
  attempt(pg, as, "delete from public.membership_roles where membership_id=$1 and role_id=$2", [m, r]);

/** Does this membership_roles row exist? Asked as service_role, so RLS cannot lie. */
async function rowExists(pg: Client, m: string, r: string): Promise<boolean> {
  const res = await pg.query(
    "select 1 from public.membership_roles where membership_id=$1 and role_id=$2",
    [m, r]
  );
  return (res.rowCount ?? 0) > 0;
}

/** Like attempt(), but COMMITS on success — for building fixtures via the real path. */
async function commitAs(
  pg: Client,
  userId: string,
  sql: string,
  params: unknown[]
): Promise<Outcome> {
  await pg.query("begin");
  try {
    await pg.query("set local role authenticated");
    await pg.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId })]);
    await pg.query(sql, params);
    await pg.query("commit");
    return { ok: true, message: "" };
  } catch (err) {
    await pg.query("rollback");
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

async function main(): Promise<void> {
  const admin = createClient(SUPA_URL, SUPA_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const isLocalDb = /@(localhost|127\.0\.0\.1)[:/]/.test(DB_URL);
  const pg = new Client({ connectionString: DB_URL, ssl: isLocalDb ? undefined : true });
  await pg.connect();

  try {
    await cleanup(admin);

    // ---- The org the 20260608000003 header warned about --------------------
    const org = await makeOrg(admin, "Main");
    const roleAdmin = await makeRole(admin, org, "Admin", true);
    // HR is NOT an admin role, yet it holds members.manage. This is the exact
    // configuration whose arrival made the old assumption expire.
    const roleHR = await makeRole(admin, org, "HR", false, ["members.manage"]);
    const roleWarehouse = await makeRole(admin, org, "Warehouse", false);
    // Holding roles.manage lets you edit any role's permissions => escalation
    // without ever touching is_admin.
    const roleEditor = await makeRole(admin, org, "Role Editor", false, ["roles.manage"]);

    const uAdmin = await makeUser(admin, EMAILS.admin);
    const uManager = await makeUser(admin, EMAILS.manager);
    const uTarget = await makeUser(admin, EMAILS.target);
    const uBystander = await makeUser(admin, EMAILS.bystander);

    const mAdmin = await addMembership(admin, uAdmin, org);
    const mManager = await addMembership(admin, uManager, org);
    const mTarget = await addMembership(admin, uTarget, org);
    const mBystander = await addMembership(admin, uBystander, org);

    // Bootstrap: the org's FIRST assignment (zero rows => exempt). Everything
    // after this must go through the real path.
    const boot = await admin
      .from("membership_roles")
      .insert({ membership_id: mAdmin, role_id: roleAdmin, organization_id: org });
    if (boot.error) throw new Error(`bootstrap admin: ${boot.error.message}`);

    // The manager gets HR — assigned BY the admin, through the real trigger path.
    const giveHR = await attempt(
      pg,
      { role: "authenticated", userId: uAdmin },
      "insert into public.membership_roles (membership_id, role_id, organization_id) values ($1,$2,$3)",
      [mManager, roleHR, org]
    );
    if (!giveHR.ok) throw new Error(`admin could not assign HR to manager: ${giveHR.message}`);
    // attempt() rolls back, so persist the fixture via the service key. This row is
    // NOT the org's first, so it needs the trigger to pass: assign it as the admin.
    await pg.query("begin");
    await pg.query("set local role authenticated");
    await pg.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uAdmin })]);
    await pg.query(
      "insert into public.membership_roles (membership_id, role_id, organization_id) values ($1,$2,$3)",
      [mManager, roleHR, org]
    );
    await pg.query("commit");

    console.log(`\nSeeded "${PREFIX}": admin (is_admin) + manager (HR, holds members.manage, NOT admin).`);

    // =====================================================================
    console.log("\n[1] ADMINS are exempt — they may confer anything in their org");
    const a1 = await assign(pg, { role: "authenticated", userId: uAdmin }, mTarget, roleWarehouse, org);
    check("admin assigns a role they do NOT hold (Warehouse)", a1.ok,
      a1.ok ? "this is why the exemption exists — otherwise nobody could staff a new role" : a1.message);

    const a2 = await assign(pg, { role: "authenticated", userId: uAdmin }, mTarget, roleAdmin, org);
    check("admin assigns an is_admin role", a2.ok, a2.ok ? "" : a2.message);

    const a3 = await revoke(pg, { role: "authenticated", userId: uAdmin }, mManager, roleHR);
    check("admin revokes a role they do not hold (HR)", a3.ok, a3.ok ? "" : a3.message);

    // =====================================================================
    console.log("\n[2] NON-ADMIN with members.manage + HR — the escalations that were open");
    const b1 = await assign(pg, { role: "authenticated", userId: uManager }, mTarget, roleHR, org);
    check("assigns HR (a role they DO hold) to someone else -> succeeds", b1.ok,
      b1.ok ? "within their own authority" : b1.message);

    const b2 = await assign(pg, { role: "authenticated", userId: uManager }, mTarget, roleWarehouse, org);
    check("[2a] assigns Warehouse (they do NOT hold it) -> RAISES", !b2.ok && TRIGGER_ERROR.test(b2.message),
      b2.ok ? "NO ERROR — ESCALATION OPEN" : "trigger");

    const b3 = await assign(pg, { role: "authenticated", userId: uManager }, mTarget, roleAdmin, org);
    check("[2b] assigns an is_admin role to someone else -> RAISES", !b3.ok && TRIGGER_ERROR.test(b3.message),
      b3.ok ? "NO ERROR — ESCALATION OPEN" : "trigger");

    const b4 = await assign(pg, { role: "authenticated", userId: uManager }, mManager, roleAdmin, org);
    check("[2c] THE HEADLINE: assigns an is_admin role TO THEMSELVES -> RAISES",
      !b4.ok && TRIGGER_ERROR.test(b4.message),
      b4.ok ? "NO ERROR — SELF-ESCALATION OPEN" : "trigger");

    const b5 = await assign(pg, { role: "authenticated", userId: uManager }, mManager, roleEditor, org);
    check("[2d] assigns THEMSELVES a role holding roles.manage -> RAISES",
      !b5.ok && TRIGGER_ERROR.test(b5.message),
      b5.ok ? "NO ERROR — INDIRECT ESCALATION OPEN" : "the path a members.manage split would have missed");

    // Revoking must be tested against a row that ACTUALLY EXISTS. Deleting a
    // non-existent row matches zero rows and returns no error — a vacuous pass
    // that proves nothing. So commit a real HR assignment first (as the manager,
    // legitimately), then revoke it and confirm the row is really gone.
    const giveTargetHR = await commitAs(
      pg, uManager,
      "insert into public.membership_roles (membership_id, role_id, organization_id) values ($1,$2,$3)",
      [mTarget, roleHR, org]
    );
    check("(fixture) manager assigns HR to the target, committed", giveTargetHR.ok, giveTargetHR.message);
    const b6 = await commitAs(
      pg, uManager,
      "delete from public.membership_roles where membership_id=$1 and role_id=$2",
      [mTarget, roleHR]
    );
    check("revokes HR (a role they DO hold) from someone -> succeeds", b6.ok && !(await rowExists(pg, mTarget, roleHR)),
      b6.ok ? "and the row is really gone" : b6.message);

    const b7 = await revoke(pg, { role: "authenticated", userId: uManager }, mAdmin, roleAdmin);
    check("[2e] revokes an ADMIN's is_admin role -> RAISES", !b7.ok && TRIGGER_ERROR.test(b7.message),
      b7.ok ? "NO ERROR — could strip admins, and re-arm bootstrap" : "protects the bootstrap");

    // --- soft-deleted membership confers nothing -------------------------
    const soft = await admin
      .from("memberships")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", mManager);
    if (soft.error) throw new Error(`soft-delete membership: ${soft.error.message}`);

    const b8 = await assign(pg, { role: "authenticated", userId: uManager }, mTarget, roleHR, org);
    check("[2f] after their membership is SOFT-DELETED, assigning HR -> RAISES",
      !b8.ok && TRIGGER_ERROR.test(b8.message),
      b8.ok ? "NO ERROR — soft delete did not revoke" : "may_assign_role requires an ACTIVE membership");

    await admin.from("memberships").update({ deleted_at: null }).eq("id", mManager);

    // =====================================================================
    console.log("\n[3] BOOTSTRAP: exempt exactly once per org, then never again");
    const fresh = await makeOrg(admin, "Fresh");
    const freshRole = await makeRole(admin, fresh, "Admin", true);
    const freshRole2 = await makeRole(admin, fresh, "Member", false);
    const uFresh = await makeUser(admin, EMAILS.cascade);
    const mFresh = await addMembership(admin, uFresh, fresh);
    const mFresh2 = await addMembership(admin, uBystander, fresh);

    // Committed, not rolled back: the SECOND insert must see the first.
    await pg.query("begin");
    await pg.query("set local role service_role");
    await pg.query("select set_config('request.jwt.claims', null, true)");
    let firstOk = true;
    let firstMsg = "";
    try {
      await pg.query(
        "insert into public.membership_roles (membership_id, role_id, organization_id) values ($1,$2,$3)",
        [mFresh, freshRole, fresh]
      );
      await pg.query("commit");
    } catch (err) {
      await pg.query("rollback");
      firstOk = false;
      firstMsg = err instanceof Error ? err.message : String(err);
    }
    check("first row in a BRAND-NEW org: service_role, NO JWT -> succeeds", firstOk,
      firstOk ? "structural: nobody can hold a role in an org with none" : firstMsg);

    const second = await assign(pg, { role: "service_role", userId: null }, mFresh2, freshRole2, fresh);
    check("SECOND row in that same org: service_role, NO JWT -> RAISES",
      !second.ok && TRIGGER_ERROR.test(second.message),
      second.ok ? "NO ERROR — EXEMPTION IS NOT ONE-SHOT" : "the exemption is spent");

    const inOld = await assign(pg, { role: "service_role", userId: null }, mTarget, roleWarehouse, org);
    check("org that ALREADY has assignments: service_role, NO JWT -> RAISES",
      !inOld.ok && TRIGGER_ERROR.test(inOld.message),
      inOld.ok ? "NO ERROR" : "no service_role exemption");

    const svcJwt = await assign(pg, { role: "service_role", userId: uManager }, mTarget, roleAdmin, org);
    check("service_role WITH a non-admin's JWT is NOT exempt -> RAISES",
      !svcJwt.ok && TRIGGER_ERROR.test(svcJwt.message),
      svcJwt.ok ? "NO ERROR" : "the rule follows auth.uid(), not the DB role");

    // =====================================================================
    console.log("\n[4] CASCADES: the parent is gone, so the row is debris, not a revocation");
    // Direct delete of a LIVE row is still guarded — the case the guard is FOR.
    // The caller must be one who PASSES RLS, else the DELETE is filtered to zero
    // rows and returns no error: a silent no-op that never reaches the trigger and
    // would make this assertion vacuous. uManager holds members.manage (via HR) but
    // is neither an admin nor a holder of the Admin role.
    const direct = await revoke(pg, { role: "authenticated", userId: uManager }, mAdmin, roleAdmin);
    check("direct delete, parent ALIVE, caller is a non-admin non-holder -> RAISES",
      !direct.ok && TRIGGER_ERROR.test(direct.message),
      direct.ok ? "NO ERROR — the cascade exemption is swallowing LIVE rows" : "guard intact; the exemption did not widen it");

    // The contrast: a caller WITHOUT members.manage is filtered by RLS before the
    // trigger is reached. No error — but no deletion either. Pin the distinction.
    const filtered = await revoke(pg, { role: "authenticated", userId: uBystander }, mAdmin, roleAdmin);
    check("a caller without members.manage: RLS filters the row -> silent no-op, row SURVIVES",
      filtered.ok && (await rowExists(pg, mAdmin, roleAdmin)),
      "USING clause matched zero rows — denial by invisibility, not by error");

    const directAdmin = await revoke(pg, { role: "authenticated", userId: uAdmin }, mTarget, roleWarehouse);
    check("direct delete, parent ALIVE, caller IS an admin -> succeeds", directAdmin.ok,
      directAdmin.ok ? "" : directAdmin.message);

    // Path 1: delete the ORG (cascades via BOTH roles and memberships).
    const cascadeOrg = await admin.from("organizations").delete().eq("id", fresh);
    check("delete an ORG with roles assigned -> succeeds (cascade completes)", !cascadeOrg.error,
      cascadeOrg.error?.message ?? "");
    const debris = await pg.query(
      `select (select count(*) from public.membership_roles where organization_id=$1)
            + (select count(*) from public.memberships where organization_id=$1)
            + (select count(*) from public.roles where organization_id=$1)
            + (select count(*) from public.organizations where id=$1) as n`,
      [fresh]
    );
    check("after the org cascade, NO rows survive anywhere (no half-fired debris)",
      Number(debris.rows[0]?.n ?? -1) === 0, `rows left: ${debris.rows[0]?.n}`);

    // Path 2: delete a USER (cascades via memberships only — the role stays alive,
    // which is why the guard must check BOTH parents).
    const delUser = await admin.auth.admin.deleteUser(uTarget);
    check("delete a USER with roles assigned -> succeeds", !delUser.error,
      delUser.error?.message ?? "cascades via memberships; the role remains");

    // Path 3: delete a ROLE that is assigned (cascades via roles only — the
    // membership stays alive). Warehouse is non-admin, so the last-admin guard
    // (20260609000005) is not in play; this isolates OUR trigger.
    const delRole = await admin.from("roles").delete().eq("id", roleWarehouse);
    check("delete a ROLE that is assigned -> succeeds", !delRole.error,
      delRole.error?.message ?? "cascades via roles; the membership remains");

    // =====================================================================
    console.log("\n[5] WHICH mechanism denies — trigger fires BEFORE the RLS WITH CHECK");
    const noPerm = await assign(pg, { role: "authenticated", userId: uBystander }, mBystander, roleHR, org);
    check("a user with NO members.manage is denied when assigning", !noPerm.ok,
      noPerm.ok ? "NO ERROR" : "");
    check("...and it is the TRIGGER that denied, not the RLS policy",
      !noPerm.ok && TRIGGER_ERROR.test(noPerm.message) && !RLS_ERROR.test(noPerm.message),
      `BEFORE ROW runs first — message: ${noPerm.message.split("\n")[0]}`);

    // =====================================================================
    console.log("\n[6] users.view is GONE, and the delete was surgical");
    const uv = await admin.from("permissions").select("id").eq("key", "users.view");
    check("permissions has ZERO rows for 'users.view'", (uv.data?.length ?? -1) === 0);

    const orphan = await pg.query(
      `select count(*)::int as n from public.role_permissions rp
        where not exists (select 1 from public.permissions p where p.id = rp.permission_id)`
    );
    check("no role_permissions row survives pointing at a deleted permission",
      Number(orphan.rows[0]?.n ?? -1) === 0, "cascade did its job");

    const survivors = await admin.from("permissions").select("key").in("key", ["roles.manage", "members.manage"]);
    check("'roles.manage' and 'members.manage' still exist", (survivors.data?.length ?? 0) === 2,
      (survivors.data ?? []).map((p: { key: string }) => p.key).sort().join(","));

    const invite = await admin.from("permissions").select("id").eq("key", "users.invite");
    check("'users.invite' is still gone (20260610000003 holds)", (invite.data?.length ?? -1) === 0);

    await cleanup(admin);
    console.log("\n(cleaned up test orgs, users, roles)\n");
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
