/**
 * Verification harness for the door onto record_grants (migration 20260716000008):
 * `shell.grant_access` and `shell.revoke_access`.
 *
 * The door is called AS THE IMPERSONATED USER (`set local role authenticated` +
 * `request.jwt.claims`, which is what auth.uid() reads) — never from a privileged
 * connection — except where a case explicitly tests service_role. That matters:
 * the functions are SECURITY DEFINER, so they RUN as the owner, and the whole
 * question is whether they still hold the CALLER to `auth_user_can_grant`.
 *
 * Covered:
 *
 *   RAISES — permission (the door must not soften can_grant's narrowness):
 *     no grant at all / access='write' / access='read' / not in the tree; plus the
 *     two deliberate can_grant omissions — a private row's OWNER, and an org row's
 *     ADMIN. If the door ever "helpfully" allowed those, can_grant's narrowness
 *     would be pointless.
 *
 *   RAISES — shape (these must NOT depend on the permission check):
 *     'app_instances' (no visibility column) / 'record_grants' (likewise) /
 *     'pg_class' (wrong schema) / an injection string / a nonexistent record /
 *     zero or two subjects / access='admin'.
 *
 *   RAISES — identity:
 *     NO JWT context, even as service_role. Load-bearing: SECURITY DEFINER does
 *     not exempt the door from proving who is calling. "I am service_role" is not
 *     an identity.
 *
 *   SUCCEEDS: grant to user / role in own org / role in the PARENT org / group;
 *     re-grant UPDATES in place (the partial-index inference proof); org_id is the
 *     ROW's org and granted_by is the caller; and the produced grant is LIVE — the
 *     grantee can actually read the row via auth_user_can_read afterwards.
 *
 *   STILL SUBJECT TO THE 4a-2 TRIGGER: granting to a SIBLING org's role raises from
 *     inside the door — it does not bypass record_grants' subject-in-tree trigger.
 *
 *   revoke_access: revokes and the read dies with it; absent grant -> false, no
 *     raise; 'write'-only and no-grant callers raise.
 *
 * Connection approach mirrors verify-row-immutability.ts.
 *
 * Env: the usual Supabase vars from the root `.env`, plus SUPABASE_DB_URL.
 * Defaults to the local `supabase start` stack.
 *
 * Run:  pnpm --filter @platform/db exec tsx scripts/verify-grant-access.ts
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";

import { assertLocalDatabase } from "./db-guard";

// FIRST statement: refuse to run against a non-local database. This script WRITES.
// (db-guard loads the root .env itself, so this is safe before dotenv.config below.)
assertLocalDatabase("verify-grant-access.ts");

const rootEnv = resolve(process.cwd(), "../../.env");
dotenv.config({ path: existsSync(rootEnv) ? rootEnv : undefined });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;
const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!URL || !SECRET) throw new Error("Missing Supabase env in root .env");

const PREFIX = "GrantAccess Test"; // tag so cleanup is targeted
const EMAILS = {
  hq: "ga-hq@grantaccess.test",
  granter: "ga-granter@grantaccess.test",
  writer: "ga-writer@grantaccess.test",
  reader: "ga-reader@grantaccess.test",
  plain: "ga-plain@grantaccess.test",
  admin: "ga-admin@grantaccess.test",
  owner: "ga-owner@grantaccess.test",
  target: "ga-target@grantaccess.test",
  stranger: "ga-stranger@grantaccess.test",
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

async function makeRole(admin: SupabaseClient, orgId: string, name: string, isAdmin = false): Promise<string> {
  const res = await admin
    .from("roles")
    .insert({ organization_id: orgId, name: `${PREFIX} ${name}`, is_admin: isAdmin })
    .select("id")
    .single();
  if (res.error || !res.data) throw new Error(`create role ${name}: ${res.error?.message}`);
  return (res.data as { id: string }).id;
}

async function holdRole(admin: SupabaseClient, membershipId: string, roleId: string, orgId: string): Promise<void> {
  const res = await admin
    .from("membership_roles")
    .insert({ membership_id: membershipId, role_id: roleId, organization_id: orgId });
  if (res.error) throw new Error(`hold role: ${res.error.message}`);
}

async function makeGroup(admin: SupabaseClient, orgId: string, name: string): Promise<string> {
  const res = await admin
    .from("groups")
    .insert({ org_id: orgId, name: `${PREFIX} ${name}` })
    .select("id")
    .single();
  if (res.error || !res.data) throw new Error(`create group ${name}: ${res.error?.message}`);
  return (res.data as { id: string }).id;
}

async function addToGroup(admin: SupabaseClient, groupId: string, userId: string, orgId: string): Promise<void> {
  const res = await admin.from("group_members").insert({ group_id: groupId, user_id: userId, org_id: orgId });
  if (res.error) throw new Error(`add to group: ${res.error.message}`);
}

type Visibility = "org" | "private" | "restricted";
type Item = { id: string; orgId: string; ownerId: string; visibility: Visibility };

async function makeItem(
  admin: SupabaseClient,
  orgId: string,
  ownerId: string,
  name: string,
  visibility: Visibility
): Promise<Item> {
  const res = await admin
    .from("inventory_items")
    .insert({ org_id: orgId, owner_id: ownerId, name: `${PREFIX} ${name}`, visibility })
    .select("id")
    .single();
  if (res.error || !res.data) throw new Error(`create item ${name}: ${res.error?.message}`);
  return { id: (res.data as { id: string }).id, orgId, ownerId, visibility };
}

/** Seeds a grant directly as service_role — the bootstrap the shell does at creation. */
async function seedGrant(admin: SupabaseClient, row: Record<string, string | null>): Promise<void> {
  const res = await admin.from("record_grants").insert(row);
  if (res.error) throw new Error(`seed grant: ${res.error.message}`);
}

type Subjects = { user?: string; role?: string; group?: string };
type Outcome<T> = { raised: boolean; msg: string; value: T | null };

/**
 * Calls shell.grant_access as `userId` (or with NO JWT when null), inside a
 * rolled-back transaction unless `commit` is set. `role` lets a case test the door
 * from a service_role connection.
 */
async function doGrant(
  pg: Client,
  userId: string | null,
  args: { table?: string; recordId?: string; access?: string | null; subjects?: Subjects },
  opts: { role?: "authenticated" | "service_role"; commit?: boolean } = {}
): Promise<Outcome<string>> {
  const role = opts.role ?? "authenticated";
  const s = args.subjects ?? {};
  await pg.query("begin");
  try {
    await pg.query(`set local role ${role}`);
    await pg.query("select set_config('request.jwt.claims', $1, true)", [
      userId === null ? null : JSON.stringify({ sub: userId }),
    ]);
    const res = await pg.query(
      "select shell.grant_access($1, $2, $3, $4, $5, $6) as id",
      [args.table ?? null, args.recordId ?? null, args.access ?? null,
       s.user ?? null, s.role ?? null, s.group ?? null]
    );
    if (opts.commit) await pg.query("commit"); else await pg.query("rollback");
    return { raised: false, msg: "", value: res.rows[0].id };
  } catch (err: unknown) {
    await pg.query("rollback");
    return { raised: true, msg: err instanceof Error ? err.message : String(err), value: null };
  }
}

async function doRevoke(
  pg: Client,
  userId: string | null,
  args: { table: string; recordId: string; subjects: Subjects },
  opts: { commit?: boolean } = {}
): Promise<Outcome<boolean>> {
  const s = args.subjects;
  await pg.query("begin");
  try {
    await pg.query("set local role authenticated");
    await pg.query("select set_config('request.jwt.claims', $1, true)", [
      userId === null ? null : JSON.stringify({ sub: userId }),
    ]);
    const res = await pg.query(
      "select shell.revoke_access($1, $2, $3, $4, $5) as ok",
      [args.table, args.recordId, s.user ?? null, s.role ?? null, s.group ?? null]
    );
    if (opts.commit) await pg.query("commit"); else await pg.query("rollback");
    return { raised: false, msg: "", value: res.rows[0].ok };
  } catch (err: unknown) {
    await pg.query("rollback");
    return { raised: true, msg: err instanceof Error ? err.message : String(err), value: null };
  }
}

/** Reads back can_read as the given user — proves a grant is LIVE, not just stored. */
async function canRead(pg: Client, userId: string, item: Item): Promise<boolean> {
  await pg.query("begin");
  try {
    await pg.query("set local role authenticated");
    await pg.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId })]);
    const res = await pg.query(
      "select private.auth_user_can_read('inventory_items', $1, $2, $3, $4) as ok",
      [item.id, item.orgId, item.ownerId, item.visibility]
    );
    return res.rows[0].ok === true;
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

    // HQ -> Branch C, plus sibling Branch B (for the subject-in-tree case).
    const hq = await makeOrg(admin, "HQ", null);
    const branchC = await makeOrg(admin, "Branch C", hq);
    const branchB = await makeOrg(admin, "Branch B", hq);
    const otherOrg = await makeOrg(admin, "Other", null);

    const uHq = await makeUser(admin, EMAILS.hq);
    const uGranter = await makeUser(admin, EMAILS.granter);
    const uWriter = await makeUser(admin, EMAILS.writer);
    const uReader = await makeUser(admin, EMAILS.reader);
    const uPlain = await makeUser(admin, EMAILS.plain);
    const uAdmin = await makeUser(admin, EMAILS.admin);
    const uOwner = await makeUser(admin, EMAILS.owner);
    const uTarget = await makeUser(admin, EMAILS.target);
    const uStranger = await makeUser(admin, EMAILS.stranger);

    const mHq = await addMembership(admin, uHq, hq);
    await addMembership(admin, uGranter, branchC);
    await addMembership(admin, uWriter, branchC);
    await addMembership(admin, uReader, branchC);
    await addMembership(admin, uPlain, branchC);
    const mAdmin = await addMembership(admin, uAdmin, branchC);
    await addMembership(admin, uOwner, branchC);
    await addMembership(admin, uTarget, branchC);
    await addMembership(admin, uStranger, otherOrg);

    const roleHq = await makeRole(admin, hq, "HQ Role");
    const roleC = await makeRole(admin, branchC, "C Role");
    const roleB = await makeRole(admin, branchB, "B Role"); // sibling — subject-in-tree bait
    const roleCAdmin = await makeRole(admin, branchC, "C Admin", true);
    await holdRole(admin, mHq, roleHq, hq);
    await holdRole(admin, mAdmin, roleCAdmin, branchC);

    const groupC = await makeGroup(admin, branchC, "C Group");
    await addToGroup(admin, groupC, uTarget, branchC);

    const T = "inventory_items";

    // The restricted row the door operates on. uGranter holds 'grant' on it —
    // seeded directly as service_role, which is exactly the defaultGrants bootstrap
    // the migration header describes (can_grant requires an existing 'grant', so the
    // first one cannot come through the door).
    const item = await makeItem(admin, branchC, uOwner, "restricted item", "restricted");
    await seedGrant(admin, { table_name: T, record_id: item.id, org_id: branchC, subject_user_id: uGranter, access: "grant", granted_by: uOwner });
    await seedGrant(admin, { table_name: T, record_id: item.id, org_id: branchC, subject_user_id: uWriter, access: "write", granted_by: uOwner });
    await seedGrant(admin, { table_name: T, record_id: item.id, org_id: branchC, subject_user_id: uReader, access: "read", granted_by: uOwner });

    const privItem = await makeItem(admin, branchC, uOwner, "private item", "private");
    const orgItem = await makeItem(admin, branchC, uOwner, "org item", "org");
    const appInst = await admin
      .from("app_definitions")
      .insert({ key: `${PREFIX}-def`, name: "GA Def", manifest: {} })
      .select("id")
      .single();
    if (appInst.error) throw new Error(`app def: ${appInst.error.message}`);

    console.log(`\nSeeded "${PREFIX}": HQ -> Branch C (+ sibling B, unrelated Other); restricted item with grant/write/read holders.`);

    // =========================================================================
    // [1] RAISES — permission
    // =========================================================================
    console.log("\n[1] grant_access RAISES on insufficient permission");
    const noGrant = await doGrant(pg, uPlain, { table: T, recordId: item.id, access: "read", subjects: { user: uTarget } });
    check("caller holds NO grant -> raises", noGrant.raised && /not permitted/.test(noGrant.msg), noGrant.msg.split("\n")[0]);

    const asWriter = await doGrant(pg, uWriter, { table: T, recordId: item.id, access: "read", subjects: { user: uTarget } });
    check("caller holds 'write' (not 'grant') -> raises", asWriter.raised && /not permitted/.test(asWriter.msg), asWriter.msg.split("\n")[0]);

    const asReader = await doGrant(pg, uReader, { table: T, recordId: item.id, access: "read", subjects: { user: uTarget } });
    check("caller holds 'read' -> raises", asReader.raised && /not permitted/.test(asReader.msg), asReader.msg.split("\n")[0]);

    const asStranger = await doGrant(pg, uStranger, { table: T, recordId: item.id, access: "read", subjects: { user: uTarget } });
    check("caller is not in the row's tree -> raises", asStranger.raised && /not permitted/.test(asStranger.msg), asStranger.msg.split("\n")[0]);

    console.log("\n[2] The door does NOT soften can_grant's deliberate narrowness");
    const privOwner = await doGrant(pg, uOwner, { table: T, recordId: privItem.id, access: "read", subjects: { user: uTarget } });
    check(
      "private row + its OWNER -> raises",
      privOwner.raised && /not permitted/.test(privOwner.msg),
      "a private row can never be shared; it is born restricted or not at all"
    );

    const orgAdmin = await doGrant(pg, uAdmin, { table: T, recordId: orgItem.id, access: "read", subjects: { user: uTarget } });
    check(
      "org row + an ADMIN of the org -> raises",
      orgAdmin.raised && /not permitted/.test(orgAdmin.msg),
      "the tree already reads it; a grant would be a no-op row"
    );

    // =========================================================================
    // [3] RAISES — shape. These must NOT depend on the permission check.
    // =========================================================================
    console.log("\n[3] grant_access RAISES on a non-grantable table (shape, not a list)");
    const inst = await doGrant(pg, uGranter, { table: "app_instances", recordId: item.id, access: "read", subjects: { user: uTarget } });
    check("'app_instances' -> not a grantable table (no visibility column)", inst.raised && /not a grantable table/.test(inst.msg), inst.msg.split("\n")[0]);

    const rg = await doGrant(pg, uGranter, { table: "record_grants", recordId: item.id, access: "read", subjects: { user: uTarget } });
    check("'record_grants' -> not a grantable table", rg.raised && /not a grantable table/.test(rg.msg), rg.msg.split("\n")[0]);

    const pgc = await doGrant(pg, uGranter, { table: "pg_class", recordId: item.id, access: "read", subjects: { user: uTarget } });
    check("'pg_class' -> not a grantable table (wrong schema)", pgc.raised && /not a grantable table/.test(pgc.msg), pgc.msg.split("\n")[0]);

    console.log("\n[4] Injection attempts die at the shape check, before any dynamic SQL");
    const injections = [
      `inventory_items"; drop table public.record_grants; --`,
      `inventory_items'; drop table public.record_grants; --`,
      `inventory_items; delete from public.record_grants`,
    ];
    for (const bad of injections) {
      const r = await doGrant(pg, uGranter, { table: bad, recordId: item.id, access: "read", subjects: { user: uTarget } });
      check(`injection rejected: ${bad.slice(0, 32)}...`, r.raised && /not a grantable table/.test(r.msg));
    }
    // The database must be intact: record_grants still exists and still has our seeds.
    const intact = await admin.from("record_grants").select("id").eq("record_id", item.id);
    check(
      "the database is INTACT after the injection attempts",
      !intact.error && (intact.data?.length ?? 0) === 3,
      intact.error?.message ?? `record_grants still holds ${intact.data?.length ?? 0} seeded grants`
    );

    console.log("\n[5] grant_access RAISES on bad arguments");
    const missing = await doGrant(pg, uGranter, {
      table: T, recordId: "00000000-0000-0000-0000-000000000000", access: "read", subjects: { user: uTarget },
    });
    check("nonexistent record_id -> 'record not found'", missing.raised && /record not found/.test(missing.msg), missing.msg.split("\n")[0]);

    const zeroSubj = await doGrant(pg, uGranter, { table: T, recordId: item.id, access: "read", subjects: {} });
    check("zero subject params -> raises", zeroSubj.raised && /exactly one subject/.test(zeroSubj.msg), zeroSubj.msg.split("\n")[0]);

    const twoSubj = await doGrant(pg, uGranter, { table: T, recordId: item.id, access: "read", subjects: { user: uTarget, role: roleC } });
    check("two subject params -> raises", twoSubj.raised && /exactly one subject/.test(twoSubj.msg), twoSubj.msg.split("\n")[0]);

    const badAccess = await doGrant(pg, uGranter, { table: T, recordId: item.id, access: "admin", subjects: { user: uTarget } });
    check("access = 'admin' -> raises", badAccess.raised && /invalid access level/.test(badAccess.msg), badAccess.msg.split("\n")[0]);

    // =========================================================================
    // [6] RAISES — identity. THE LOAD-BEARING ONE.
    // =========================================================================
    console.log("\n[6] NO JWT context -> raises, even as service_role (the load-bearing assertion)");
    const noJwtAuth = await doGrant(pg, null, { table: T, recordId: item.id, access: "read", subjects: { user: uTarget } });
    check("no JWT, role authenticated -> raises", noJwtAuth.raised && /not permitted/.test(noJwtAuth.msg), noJwtAuth.msg.split("\n")[0]);

    const noJwtService = await doGrant(pg, null, { table: T, recordId: item.id, access: "read", subjects: { user: uTarget } }, { role: "service_role" });
    check(
      "no JWT, role service_role -> RAISES",
      noJwtService.raised && /not permitted/.test(noJwtService.msg),
      "SECURITY DEFINER does not exempt the door: 'I am service_role' is not an identity"
    );

    // =========================================================================
    // [7] SUCCEEDS — and produces LIVE grants
    // =========================================================================
    console.log("\n[7] grant_access SUCCEEDS for a 'grant'-level caller");
    check("target cannot read the restricted row beforehand", !(await canRead(pg, uTarget, item)));

    const gUser = await doGrant(pg, uGranter, { table: T, recordId: item.id, access: "read", subjects: { user: uTarget } }, { commit: true });
    check("grants to a USER", !gUser.raised && !!gUser.value, gUser.raised ? gUser.msg : `grant id ${gUser.value}`);
    check("=> the grant is LIVE: the grantee can now read the row", await canRead(pg, uTarget, item), "end-to-end through auth_user_can_read");

    const gRole = await doGrant(pg, uGranter, { table: T, recordId: item.id, access: "read", subjects: { role: roleC } }, { commit: true });
    check("grants to a ROLE in the row's own org", !gRole.raised && !!gRole.value, gRole.raised ? gRole.msg : "");

    const gParentRole = await doGrant(pg, uGranter, { table: T, recordId: item.id, access: "read", subjects: { role: roleHq } }, { commit: true });
    check("grants to a ROLE in the PARENT org", !gParentRole.raised && !!gParentRole.value, gParentRole.raised ? gParentRole.msg : "");
    check("=> that parent-role grant is LIVE for a holder of the HQ role", await canRead(pg, uHq, item));

    const gGroup = await doGrant(pg, uGranter, { table: T, recordId: item.id, access: "read", subjects: { group: groupC } }, { commit: true });
    check("grants to a GROUP", !gGroup.raised && !!gGroup.value, gGroup.raised ? gGroup.msg : "");

    // --- org_id / granted_by provenance ---------------------------------------
    console.log("\n[8] The written row's org_id is the ROW's org; granted_by is the caller");
    const written = await admin
      .from("record_grants")
      .select("id, org_id, granted_by, access")
      .eq("record_id", item.id)
      .eq("subject_user_id", uTarget)
      .single();
    check("org_id == the row's org (never a parameter)", written.data?.org_id === branchC, `${written.data?.org_id}`);
    check("granted_by == the caller (uGranter)", written.data?.granted_by === uGranter, `${written.data?.granted_by}`);

    // --- the partial-index inference proof -------------------------------------
    console.log("\n[9] Re-granting the same (row, subject) UPDATES in place (partial-index inference)");
    const before = await admin.from("record_grants").select("id").eq("record_id", item.id).eq("subject_user_id", uTarget);
    check("exactly one grant for (row, target) beforehand", (before.data?.length ?? 0) === 1, `${before.data?.length ?? 0}`);

    const regrant = await doGrant(pg, uGranter, { table: T, recordId: item.id, access: "write", subjects: { user: uTarget } }, { commit: true });
    check("re-grant at a different level succeeds", !regrant.raised, regrant.raised ? regrant.msg : "");
    const after = await admin.from("record_grants").select("id, access").eq("record_id", item.id).eq("subject_user_id", uTarget);
    check("STILL exactly one row (no duplicate)", (after.data?.length ?? 0) === 1, `${after.data?.length ?? 0} row(s)`);
    check("the access level was UPDATED to 'write'", after.data?.[0]?.access === "write", `${after.data?.[0]?.access}`);
    check("the row id is unchanged (updated, not replaced)", after.data?.[0]?.id === before.data?.[0]?.id);

    // =========================================================================
    // [10] The door does not bypass the 4a-2 subject-in-tree trigger
    // =========================================================================
    console.log("\n[10] The door does NOT bypass record_grants' subject-in-tree trigger");
    const sibling = await doGrant(pg, uGranter, { table: T, recordId: item.id, access: "read", subjects: { role: roleB } });
    check(
      "granting to a SIBLING org's role raises from inside the door",
      sibling.raised && /not in the org tree/.test(sibling.msg),
      sibling.msg.split("\n")[0]
    );

    // =========================================================================
    // [11] revoke_access
    // =========================================================================
    console.log("\n[11] revoke_access");
    // The revoke subject must be uPlain, NOT uTarget. uTarget is a member of groupC,
    // which ALSO holds a grant on this row, so revoking uTarget's user grant would
    // correctly leave them reading via the group — revoking one subject does not
    // touch another. Using uTarget here would test nothing about revoke and would
    // fail for a good reason. uPlain holds no role and is in no group, so their user
    // grant is their only path to the row.
    const gPlain = await doGrant(pg, uGranter, { table: T, recordId: item.id, access: "read", subjects: { user: uPlain } }, { commit: true });
    check("seed: grant read to a subject with exactly ONE access path", !gPlain.raised, gPlain.raised ? gPlain.msg : "");
    check("sanity: that grantee can read before revoking", await canRead(pg, uPlain, item));

    const rev = await doRevoke(pg, uGranter, { table: T, recordId: item.id, subjects: { user: uPlain } }, { commit: true });
    check("a 'grant'-level caller revokes -> returns true", !rev.raised && rev.value === true, rev.raised ? rev.msg : `${rev.value}`);
    check("=> the grantee can no longer read the row", !(await canRead(pg, uPlain, item)), "the revoke is live too");

    // Revoking one subject leaves other subjects' grants alone — uTarget still reads
    // via groupC even though their user grant is gone.
    const revTarget = await doRevoke(pg, uGranter, { table: T, recordId: item.id, subjects: { user: uTarget } }, { commit: true });
    check("revoking a user grant returns true", !revTarget.raised && revTarget.value === true, revTarget.raised ? revTarget.msg : "");
    check(
      "...but that user still reads via the GROUP grant (revoke is per-subject)",
      await canRead(pg, uTarget, item),
      "revoking one subject must not silently drop another's access"
    );

    const revAgain = await doRevoke(pg, uGranter, { table: T, recordId: item.id, subjects: { user: uTarget } });
    check(
      "revoking something that does not exist -> false, does NOT raise",
      !revAgain.raised && revAgain.value === false,
      "absence is not an error; idempotent cleanup must be possible"
    );

    const revWriter = await doRevoke(pg, uWriter, { table: T, recordId: item.id, subjects: { user: uReader } });
    check("a 'write'-only caller cannot revoke -> raises", revWriter.raised && /not permitted/.test(revWriter.msg), revWriter.msg.split("\n")[0]);

    const revPlain = await doRevoke(pg, uPlain, { table: T, recordId: item.id, subjects: { user: uReader } });
    check("a caller with no grant cannot revoke -> raises", revPlain.raised && /not permitted/.test(revPlain.msg), revPlain.msg.split("\n")[0]);

    // Self-revocation: uGranter holds 'grant', so can_grant PASSES and the delete
    // goes through — a user CAN revoke their own 'grant'-level grant. It is a
    // one-way door: afterwards can_grant is false and they cannot grant again (nor
    // restore themselves), and being the row's owner would not help. Asserting what
    // actually happens rather than what one might assume.
    console.log("\n[12] Self-revocation is permitted, and is a ONE-WAY door");
    const selfRev = await doRevoke(pg, uGranter, { table: T, recordId: item.id, subjects: { user: uGranter } }, { commit: true });
    check("a user CAN revoke their own 'grant'-level grant (can_grant passes)", !selfRev.raised && selfRev.value === true, selfRev.raised ? selfRev.msg : `${selfRev.value}`);
    const afterSelf = await doGrant(pg, uGranter, { table: T, recordId: item.id, access: "read", subjects: { user: uTarget } });
    check(
      "=> afterwards they can no longer grant (one-way; no self-restore)",
      afterSelf.raised && /not permitted/.test(afterSelf.msg),
      afterSelf.msg.split("\n")[0]
    );

    await cleanup(admin);
    await admin.from("app_definitions").delete().eq("key", `${PREFIX}-def`);
    console.log("\n(cleaned up test orgs, users, roles, groups, items, grants)\n");
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
