/**
 * Verification harness for the client-grant tightening (migration 20260717000001).
 *
 * UPDATED for 20260717000005, which opens inventory_items to client INSERT/UPDATE as
 * the Cortex WRITE PATH. This file now asserts inventory_items as the deliberate,
 * RLS-gated exception — writes go through the policies, not a table-privilege revoke —
 * while app_instances / groups / group_members stay write-sealed and DELETE on
 * inventory_items stays denied (it was never granted).
 *
 * Asserts on ACTUAL CATALOG STATE, not on behavior alone. Behavior can be right for
 * the wrong reason: before this migration every one of these tables was already
 * unwritable by clients — but only because RLS had no write policy, while the table
 * privileges were wide open. A behavior-only test would have passed against the
 * loose state and proved nothing. So the catalog is the primary assertion and the
 * behavioral checks sit on top of it.
 *
 * Covered:
 *   CATALOG:
 *     - anon holds NO privileges on any of the five Cortex tables
 *     - authenticated holds SELECT on all Cortex tables. Writes: NONE on
 *       app_instances / groups / group_members; on inventory_items it now holds
 *       INSERT + UPDATE (but NOT DELETE) — the write path opened by 20260717000005,
 *       gated by RLS policies rather than table privilege. (record_grants:
 *       authenticated holds nothing at all — sealed by 20260716000004, untouched here.)
 *     - service_role still holds insert/update/delete on all five. Asserted
 *       explicitly: the shell writes as service_role, and revoking it would break
 *       every Cortex write path there is.
 *
 *   BEHAVIORAL:
 *     - as authenticated, a permitted member's UPDATE/INSERT on inventory_items now
 *       SUCCEEDS (the open write path), while the same role's write to a row it may
 *       not touch is filtered by RLS (0 rows), and an INSERT with a forged owner_id
 *       is rejected by the insert policy's owner pin. DELETE still RAISES 42501
 *       'permission denied' — never granted, so the table-privilege revoke (not RLS)
 *       is what blocks it, and the distinct-message proof now rides on DELETE.
 *     - as authenticated, SELECT on inventory_items still works and still returns
 *       exactly what can_read allows — the write path did not touch reads.
 *
 *   THE DEFAULT-PRIVILEGES PROOF (load-bearing): creates a throwaway table in
 *     `public` AS postgres — the same way a migration creates one — and asserts
 *     anon/authenticated did NOT inherit insert/update/delete while service_role
 *     did. Without this, the `alter default privileges` half of the migration is
 *     entirely untested: nothing else in the harness would notice if it were
 *     dropped.
 *
 *   NON-VACUITY (this migration has no function to mutate): the same catalog
 *     assertions are run against public.messages, an existing my-platform table
 *     deliberately left with the loose grants. They must FAIL there. That is the
 *     pre-migration state, still present in the same database, proving the
 *     assertions can distinguish tightened from untightened rather than passing on
 *     anything they are pointed at. messages failing here is CORRECT and expected —
 *     see the scope boundary in the migration header.
 *
 * Connection approach mirrors verify-grant-access.ts.
 *
 * Env: the usual Supabase vars from the root `.env`, plus SUPABASE_DB_URL.
 * Defaults to the local `supabase start` stack.
 *
 * Run:  pnpm --filter @platform/db exec tsx scripts/verify-client-grants.ts
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";

import { assertLocalDatabase } from "./db-guard";

// FIRST statement: refuse to run against a non-local database. This script WRITES.
// (db-guard loads the root .env itself, so this is safe before dotenv.config below.)
assertLocalDatabase("verify-client-grants.ts");

const rootEnv = resolve(process.cwd(), "../../.env");
dotenv.config({ path: existsSync(rootEnv) ? rootEnv : undefined });

const SUPA_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const SUPA_KEY = (process.env.SUPABASE_SECRET_KEY ?? "").trim();
const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!SUPA_URL || !SUPA_KEY) throw new Error("Missing Supabase env in root .env");

const PREFIX = "ClientGrants Test";
const EMAILS = { member: "cg-member@clientgrants.test" };
const PROBE_TABLE = "zz_client_grants_probe";

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { passed++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const CORTEX4 = ["inventory_items", "app_instances", "groups", "group_members"] as const;
const ALL5 = [...CORTEX4, "record_grants"] as const;

/** The privileges a role actually holds on a table, from the live catalog. */
async function privs(pg: Client, table: string, grantee: string): Promise<Set<string>> {
  const res = await pg.query(
    `select privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and table_name = $1 and grantee = $2`,
    [table, grantee]
  );
  return new Set(res.rows.map((r) => r.privilege_type as string));
}

const WRITES = ["INSERT", "UPDATE", "DELETE"] as const;
const hasNoWrites = (p: Set<string>) => WRITES.every((w) => !p.has(w));
const hasAllWrites = (p: Set<string>) => WRITES.every((w) => p.has(w));
const show = (p: Set<string>) => (p.size ? [...p].sort().join(",") : "(none)");

async function cleanup(admin: SupabaseClient, pg: Client): Promise<void> {
  await admin.from("organizations").update({ parent_id: null }).like("name", `${PREFIX}%`);
  await admin.from("organizations").delete().like("name", `${PREFIX}%`);
  const list = await admin.auth.admin.listUsers({ perPage: 1000 });
  const emails = Object.values(EMAILS);
  for (const u of list.data.users) {
    if (u.email && emails.includes(u.email)) await admin.auth.admin.deleteUser(u.id);
  }
  await pg.query(`drop table if exists public.${PROBE_TABLE}`);
}

async function main(): Promise<void> {
  const admin = createClient(SUPA_URL, SUPA_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const isLocalDb = /@(localhost|127\.0\.0\.1)[:/]/.test(DB_URL);
  const pg = new Client({ connectionString: DB_URL, ssl: isLocalDb ? undefined : true });
  await pg.connect();

  try {
    await cleanup(admin, pg);

    // ---------------------------------------------------------------------
    // [1] anon holds nothing on any Cortex table
    // ---------------------------------------------------------------------
    console.log("\n[1] anon holds NO privileges on any Cortex table");
    for (const t of ALL5) {
      const p = await privs(pg, t, "anon");
      check(`anon on ${t} -> (none)`, p.size === 0, show(p));
    }

    // ---------------------------------------------------------------------
    // [2] authenticated: SELECT yes, writes no
    // ---------------------------------------------------------------------
    console.log("\n[2] authenticated: SELECT on all; writes only on inventory_items (the write path)");
    // inventory_items is the deliberate exception: 20260717000005 grants INSERT+UPDATE
    // so client writes can be gated by RLS policies. It keeps SELECT and is NOT
    // granted DELETE (logic.ts has no delete path).
    {
      const p = await privs(pg, "inventory_items", "authenticated");
      check("authenticated on inventory_items has SELECT", p.has("SELECT"), show(p));
      check("authenticated on inventory_items has INSERT + UPDATE (the write path)", p.has("INSERT") && p.has("UPDATE"), show(p));
      check("authenticated on inventory_items has NO DELETE", !p.has("DELETE"), show(p));
    }
    // The other three Cortex tables stay sealed: SELECT only, no client writes.
    for (const t of ["app_instances", "groups", "group_members"] as const) {
      const p = await privs(pg, t, "authenticated");
      check(`authenticated on ${t} has SELECT`, p.has("SELECT"), show(p));
      check(`authenticated on ${t} has NO insert/update/delete`, hasNoWrites(p), show(p));
    }
    const rgAuth = await privs(pg, "record_grants", "authenticated");
    check(
      "authenticated on record_grants -> (none)",
      rgAuth.size === 0,
      `${show(rgAuth)} — sealed by 20260716000004; this migration does not touch it`
    );

    // ---------------------------------------------------------------------
    // [3] service_role must keep its writes — the shell depends on it
    // ---------------------------------------------------------------------
    console.log("\n[3] service_role still holds insert/update/delete on all five");
    for (const t of ALL5) {
      const p = await privs(pg, t, "service_role");
      check(`service_role on ${t} can still write`, hasAllWrites(p), show(p));
    }

    // ---------------------------------------------------------------------
    // [4] BEHAVIORAL — the observable difference
    // ---------------------------------------------------------------------
    console.log("\n[4] BEHAVIORAL: inventory_items is the OPEN write path — writes RLS-gated, DELETE privilege-denied");

    const org = await admin.from("organizations").insert({ name: `${PREFIX} — Org` }).select("id").single();
    if (org.error || !org.data) throw new Error(`org: ${org.error?.message}`);
    const orgId = (org.data as { id: string }).id;

    const created = await admin.auth.admin.createUser({ email: EMAILS.member, password: "123456", email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`user: ${created.error?.message}`);
    const uid = created.data.user.id;
    await admin.from("users").insert({ id: uid, email: EMAILS.member, display_name: EMAILS.member });
    await admin.from("memberships").insert({ user_id: uid, organization_id: orgId });

    const item = await admin
      .from("inventory_items")
      .insert({ org_id: orgId, owner_id: uid, name: `${PREFIX} item`, visibility: "org" })
      .select("id")
      .single();
    if (item.error || !item.data) throw new Error(`item: ${item.error?.message}`);
    const itemId = (item.data as { id: string }).id;

    const hidden = await admin
      .from("inventory_items")
      .insert({ org_id: orgId, owner_id: uid, name: `${PREFIX} hidden`, visibility: "restricted" })
      .select("id")
      .single();
    if (hidden.error || !hidden.data) throw new Error(`hidden item: ${hidden.error?.message}`);
    const hiddenId = (hidden.data as { id: string }).id;

    // The write path is now OPEN for inventory_items (20260717000005 grants
    // INSERT+UPDATE to authenticated), so writes are gated by the RLS POLICIES, not
    // by a missing table privilege. A permitted member's write SUCCEEDS; the policy —
    // not a 42501 — is what stands between them and a row they may not touch.

    // UPDATE: the member owns an 'org' row in their own org -> can_write is true, so
    // the update now SUCCEEDS (before the write path it raised 42501). quantity is a
    // mutable column, so the immutability trigger is not involved.
    await pg.query("begin");
    let updCode = "";
    let updMsg = "";
    let updRows = -1;
    try {
      await pg.query("set local role authenticated");
      await pg.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid })]);
      const r = await pg.query("update public.inventory_items set quantity = 1 where id = $1", [itemId]);
      updRows = r.rowCount ?? 0;
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      updCode = e.code ?? "";
      updMsg = e.message ?? String(err);
    } finally {
      await pg.query("rollback");
    }
    check(
      "authenticated UPDATE on their own 'org' row SUCCEEDS (the write path is open)",
      updCode === "" && updRows === 1,
      updCode ? `${updCode}: ${updMsg}` : `${updRows} row(s)`
    );

    // ...but the open privilege is still RLS-GATED: the same role updating an
    // ungranted 'restricted' row in the same org is filtered to 0 rows by can_write.
    // No 42501 (they HOLD update now) — the policy, not the grant, does the blocking.
    await pg.query("begin");
    let gateRows = -1;
    let gateErr = "";
    try {
      await pg.query("set local role authenticated");
      await pg.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid })]);
      const r = await pg.query("update public.inventory_items set quantity = 1 where id = $1", [hiddenId]);
      gateRows = r.rowCount ?? 0;
    } catch (err: unknown) {
      gateErr = (err as { message?: string }).message ?? String(err);
    } finally {
      await pg.query("rollback");
    }
    check(
      "authenticated UPDATE on an ungranted 'restricted' row affects 0 rows (RLS still gates the open path)",
      gateErr === "" && gateRows === 0,
      gateErr ? gateErr : `${gateRows} row(s)`
    );

    // INSERT: owner_id pinned to self, 'org' visibility -> the insert policy admits
    // it and it SUCCEEDS (before the write path it raised 42501).
    await pg.query("begin");
    let insCode = "";
    let insMsg = "";
    let insOk = false;
    try {
      await pg.query("set local role authenticated");
      await pg.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid })]);
      await pg.query(
        `insert into public.inventory_items (org_id, owner_id, name, visibility) values ($1, $2, 'x', 'org')`,
        [orgId, uid]
      );
      insOk = true;
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      insCode = e.code ?? "";
      insMsg = e.message ?? "";
    } finally {
      await pg.query("rollback");
    }
    check(
      "authenticated INSERT with owner_id = self SUCCEEDS (the write path is open)",
      insOk,
      insCode ? `${insCode}: ${insMsg}` : "inserted"
    );

    // ...and the owner-pin in the insert policy is real: inserting a row owned by
    // SOMEONE ELSE is rejected by RLS ("new row violates row-level security policy").
    // That pin is why owner_id can be trusted even though it is later immutable.
    await pg.query("begin");
    let forgeCode = "";
    let forgeMsg = "";
    let forgeOk = false;
    try {
      await pg.query("set local role authenticated");
      await pg.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid })]);
      await pg.query(
        `insert into public.inventory_items (org_id, owner_id, name, visibility) values ($1, $2, 'x', 'org')`,
        [orgId, "00000000-0000-0000-0000-000000000000"]
      );
      forgeOk = true;
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      forgeCode = e.code ?? "";
      forgeMsg = e.message ?? "";
    } finally {
      await pg.query("rollback");
    }
    check(
      "authenticated INSERT with a FORGED owner_id is rejected by RLS (the owner pin)",
      !forgeOk && forgeCode === "42501" && /row-level security/i.test(forgeMsg),
      forgeOk ? "INSERT SUCCEEDED — owner pin missing" : `${forgeCode}: ${forgeMsg}`
    );

    // DELETE is deliberately NOT granted (logic.ts has no delete path), so it is
    // still stopped at the TABLE-PRIVILEGE layer: a 42501 'permission denied for
    // table', the distinct proof that a revoke, not RLS, is what blocks it. (RLS
    // raises 42501 too, but with a 'row-level security' message; 'permission denied'
    // is only ever the privilege revoke — the check that used to ride on INSERT.)
    await pg.query("begin");
    let delCode = "";
    let delMsg = "";
    try {
      await pg.query("set local role authenticated");
      await pg.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid })]);
      await pg.query(`delete from public.inventory_items where id = $1`, [itemId]);
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      delCode = e.code ?? "";
      delMsg = e.message ?? "";
    } finally {
      await pg.query("rollback");
    }
    check(
      "authenticated DELETE on inventory_items still RAISES 42501 'permission denied' (delete not granted)",
      delCode === "42501" && /permission denied/i.test(delMsg),
      delCode ? `${delCode}: ${delMsg}` : "NO ERROR"
    );

    // ---------------------------------------------------------------------
    // [5] BEHAVIORAL — reads must still work, and still be can_read-filtered
    // ---------------------------------------------------------------------
    console.log("\n[5] BEHAVIORAL: SELECT still works and still returns exactly what can_read allows");
    await pg.query("begin");
    let visible: string[] = [];
    let selErr = "";
    try {
      await pg.query("set local role authenticated");
      await pg.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid })]);
      const r = await pg.query("select id from public.inventory_items where org_id = $1", [orgId]);
      visible = r.rows.map((x) => x.id as string);
    } catch (err: unknown) {
      selErr = err instanceof Error ? err.message : String(err);
    } finally {
      await pg.query("rollback");
    }
    check("authenticated SELECT does not raise", selErr === "", selErr);
    check("...the 'org' row IS returned", visible.includes(itemId), `${visible.length} row(s)`);
    check(
      "...the ungranted 'restricted' row is NOT returned (can_read still filters)",
      !visible.includes(hiddenId),
      "the tightening did not replace RLS, it backs it"
    );

    // anon now gets an error rather than an empty set.
    await pg.query("begin");
    let anonCode = "";
    try {
      await pg.query("set local role anon");
      await pg.query("select 1 from public.inventory_items limit 1");
    } catch (err: unknown) {
      anonCode = (err as { code?: string }).code ?? "";
    } finally {
      await pg.query("rollback");
    }
    check(
      "anon SELECT on inventory_items RAISES 42501 (was: silently 0 rows)",
      anonCode === "42501",
      anonCode || "NO ERROR — anon still has a privilege"
    );

    // ---------------------------------------------------------------------
    // [6] THE DEFAULT-PRIVILEGES PROOF
    // ---------------------------------------------------------------------
    console.log("\n[6] DEFAULT PRIVILEGES: a NEW table in public does not hand clients writes");
    // Created as postgres — the same role our migrations run as, so the
    // postgres-owned default ACL is the one that applies.
    await pg.query(`create table public.${PROBE_TABLE} (id uuid primary key default gen_random_uuid())`);

    for (const g of ["anon", "authenticated"]) {
      const p = await privs(pg, PROBE_TABLE, g);
      check(`new table: ${g} did NOT inherit insert/update/delete`, hasNoWrites(p), show(p));
    }
    const probeSvc = await privs(pg, PROBE_TABLE, "service_role");
    check(
      "new table: service_role DID inherit insert/update/delete",
      hasAllWrites(probeSvc),
      `${show(probeSvc)} — future tool tables still work server-side`
    );

    await pg.query(`drop table public.${PROBE_TABLE}`);
    const gone = await pg.query(
      `select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = $1`,
      [PROBE_TABLE]
    );
    check("probe table dropped", (gone.rowCount ?? 0) === 0);

    // ---------------------------------------------------------------------
    // [7] service_role can still write — the path that must not break
    // ---------------------------------------------------------------------
    console.log("\n[7] service_role can still write to inventory_items and record_grants");
    const svcUpd = await admin.from("inventory_items").update({ quantity: 5 }).eq("id", itemId);
    check("service_role UPDATE on inventory_items succeeds", !svcUpd.error, svcUpd.error?.message ?? "");

    const svcGrant = await admin
      .from("record_grants")
      .insert({ table_name: "inventory_items", record_id: hiddenId, org_id: orgId, subject_user_id: uid, access: "read", granted_by: uid });
    check("service_role INSERT on record_grants succeeds (the defaultGrants bootstrap)", !svcGrant.error, svcGrant.error?.message ?? "");

    // ---------------------------------------------------------------------
    // [8] NON-VACUITY: the same assertions must FAIL on an untightened table
    // ---------------------------------------------------------------------
    console.log("\n[8] NON-VACUITY: public.messages still has the loose grants — the same checks must FAIL there");
    const msgAnon = await privs(pg, "messages", "anon");
    const msgAuth = await privs(pg, "messages", "authenticated");
    const wouldPassAnon = msgAnon.size === 0;
    const wouldPassAuthNoWrites = hasNoWrites(msgAuth);
    console.log(`     messages / anon          = ${show(msgAnon)}`);
    console.log(`     messages / authenticated = ${show(msgAuth)}`);
    check(
      "'anon holds nothing' FAILS on messages (proves the check discriminates)",
      !wouldPassAnon,
      `anon still holds ${show(msgAnon)} there`
    );
    check(
      "'authenticated has no writes' FAILS on messages (proves the check discriminates)",
      !wouldPassAuthNoWrites,
      `authenticated still holds ${show(msgAuth)} there`
    );

    // And behaviorally: an authenticated UPDATE on messages does NOT raise 42501 —
    // it is stopped by RLS instead (0 rows), which is exactly the pre-migration
    // behavior the Cortex tables used to have.
    await pg.query("begin");
    let msgCode = "";
    let msgRows = -1;
    try {
      await pg.query("set local role authenticated");
      await pg.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid })]);
      const r = await pg.query("update public.messages set content = 'x' where id = gen_random_uuid()");
      msgRows = r.rowCount ?? 0;
    } catch (err: unknown) {
      msgCode = (err as { code?: string }).code ?? "";
    } finally {
      await pg.query("rollback");
    }
    check(
      "authenticated UPDATE on messages does NOT raise 42501 (RLS is its only layer)",
      msgCode !== "42501",
      msgCode ? `raised ${msgCode}` : `no error, ${msgRows} rows — the exact state Cortex was in before this migration`
    );

    await cleanup(admin, pg);
    console.log("\n(cleaned up test org, user, items, grants, probe table)\n");
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
