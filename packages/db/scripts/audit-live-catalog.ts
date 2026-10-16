/**
 * READ-ONLY catalog audit for the Cortex permission model.
 *
 * -----------------------------------------------------------------------------
 * WHAT THIS IS (and why it is NOT a verify-* script)
 * -----------------------------------------------------------------------------
 * The verify-* harnesses BUILD fixtures and prove behaviour, so they call
 * `assertLocalDatabase` and refuse anything but the local stack. This script is
 * the opposite tool: it WRITES NOTHING and deliberately points at the LIVE
 * database to read back what is actually installed there — which version of
 * `auth_user_can_read` is live, which policies/grants/triggers exist, what the
 * visibility defaults and CHECK constraints are. It is how we confirm the live
 * catalog matches the migrations without trusting the migrations.
 *
 * SAFETY SHAPE — this script is structurally incapable of writing:
 *   - It does NOT import `assertLocalDatabase` (that guard is for writers, and it
 *     would refuse the live target this script exists to read).
 *   - It REFUSES to run when SUPABASE_DB_URL is unset. Silently falling back to
 *     the local literal would print a "live" report of the local stack — a lie.
 *     So there is no default here: no URL, no run.
 *   - Every query runs inside a single `BEGIN TRANSACTION READ ONLY … COMMIT`.
 *     Any write statement that somehow reached the server would error out.
 *   - The report header prints the connection HOST ONLY (never credentials), so
 *     the output itself states which database was audited.
 *
 * Env: the root `.env` (loaded below) plus SUPABASE_DB_URL (the Postgres
 * connection string) — which, unlike the writers, this script requires.
 *
 * Run:  pnpm --filter @platform/db exec tsx scripts/audit-live-catalog.ts
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { Client } from "pg";

// Mirror the verify scripts' env loading: the root `.env`, non-overriding.
const rootEnv = resolve(process.cwd(), "../../.env");
dotenv.config({ path: existsSync(rootEnv) ? rootEnv : undefined });

// REFUSE when SUPABASE_DB_URL is unset. There is deliberately NO local default:
// a missing URL must not silently become a "live" audit of the local stack.
const DB_URL = (process.env.SUPABASE_DB_URL ?? "").trim();
if (DB_URL === "") {
  console.error(
    "\n✗ REFUSING TO RUN audit-live-catalog.ts — SUPABASE_DB_URL is not set.\n" +
      "\n  This is a READ-ONLY audit of the LIVE database. Unlike the verify-*\n" +
      "  scripts it has no local fallback: guessing would print a 'live' report of\n" +
      "  the local stack. Point SUPABASE_DB_URL at the database you want to audit\n" +
      "  and re-run — for example:\n" +
      "\n    SUPABASE_DB_URL=<postgres connection string> \\\n" +
      "    pnpm --filter @platform/db exec tsx scripts/audit-live-catalog.ts\n"
  );
  process.exit(1);
}

/**
 * Fixed infra tables that are ALWAYS audited even though they lack the tool-table
 * column shape. Everything else is DISCOVERED at runtime (see `discoverTables`),
 * so a tool table created in another workstream cannot silently escape the audit.
 */
const INFRA_TABLES = ["app_instances", "record_grants"];

/**
 * The tables this run audits. Populated once, inside the READ ONLY transaction,
 * by dynamic discovery + INFRA_TABLES; every section iterates this list.
 */
let TABLES: string[] = [];

/**
 * Discover the target tables from the LIVE catalog: every `public` table that has
 * ALL THREE of org_id, owner_id, visibility (the tool-table shape), plus the fixed
 * infra tables. Returns a sorted, de-duplicated list. Runs inside the caller's
 * read-only transaction.
 */
async function discoverTables(pg: Client): Promise<string[]> {
  const res = await pg.query(
    `select table_name
       from information_schema.columns
      where table_schema = 'public'
        and column_name in ('org_id', 'owner_id', 'visibility')
      group by table_name
     having count(distinct column_name) = 3`
  );
  const found = new Set<string>(res.rows.map((r) => r.table_name as string));
  for (const t of INFRA_TABLES) found.add(t);
  return Array.from(found).sort();
}

/** Extract the hostname from a URL; null if it cannot be parsed (never echo creds). */
function hostOf(url: string): string | null {
  try {
    const host = new globalThis.URL(url.trim()).hostname;
    if (!host) return null;
    return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  } catch {
    return null;
  }
}

function header(title: string): void {
  console.log("\n" + "=".repeat(78));
  console.log(title);
  console.log("=".repeat(78));
}

function sub(title: string): void {
  console.log("\n" + "-".repeat(78));
  console.log(title);
  console.log("-".repeat(78));
}

async function main(): Promise<void> {
  const host = hostOf(DB_URL);
  const isLocalDb = /@(localhost|127\.0\.0\.1)[:/]/.test(DB_URL);
  const pg = new Client({ connectionString: DB_URL, ssl: isLocalDb ? undefined : true });
  await pg.connect();

  try {
    // One read-only transaction wraps the whole audit: any stray write errors out.
    await pg.query("begin transaction read only");

    // Discover the audited tables BEFORE any section runs — every section below
    // iterates this list, so discovery must happen first (still read-only).
    TABLES = await discoverTables(pg);

    header("CORTEX LIVE-CATALOG AUDIT (READ ONLY)");
    console.log(`  Database host : ${host ?? "(unparseable)"}`);
    console.log(`  Tables        : ${TABLES.length} discovered (see section 0)`);
    console.log("  Functions     : all in schema private (see section 5)");
    console.log("  Transaction   : BEGIN TRANSACTION READ ONLY (writes would error)");

    // --- [0] AUDITED TABLES ---------------------------------------------------
    header("0. AUDITED TABLES  (tool-table shape: org_id+owner_id+visibility, + infra)");
    console.log("  Discovered dynamically so a new tool table cannot escape the audit.");
    console.log(`  infra (always) : ${INFRA_TABLES.join(", ")}`);
    console.log(`  total audited  : ${TABLES.length}`);
    for (const t of TABLES) {
      const infra = INFRA_TABLES.includes(t) ? "  (infra)" : "";
      console.log(`    ${t}${infra}`);
    }

    // --- [1] RLS STATUS -------------------------------------------------------
    header("1. RLS STATUS  (pg_class: relrowsecurity, relforcerowsecurity)");
    {
      const res = await pg.query(
        `select c.relname            as table_name,
                c.relrowsecurity      as rls_enabled,
                c.relforcerowsecurity as rls_forced
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = any($1)
          order by c.relname`,
        [TABLES]
      );
      const present = new Set<string>();
      for (const r of res.rows) {
        present.add(r.table_name);
        console.log(
          `  ${r.table_name.padEnd(18)} rowsecurity=${String(r.rls_enabled).padEnd(5)} force=${r.rls_forced}`
        );
      }
      for (const t of TABLES) if (!present.has(t)) console.log(`  ${t.padEnd(18)} (table not found)`);
    }

    // --- [2] POLICIES ---------------------------------------------------------
    header("2. POLICIES  (pg_policies — qual / with_check printed in FULL)");
    {
      const res = await pg.query(
        `select tablename, policyname, cmd, roles, qual, with_check
           from pg_policies
          where schemaname = 'public' and tablename = any($1)
          order by tablename, policyname`,
        [TABLES]
      );
      if (res.rowCount === 0) console.log("  (no policies on the target tables)");
      let lastTable = "";
      for (const r of res.rows) {
        if (r.tablename !== lastTable) {
          sub(`table: ${r.tablename}`);
          lastTable = r.tablename;
        }
        console.log(`\n  policy   : ${r.policyname}`);
        console.log(`  cmd      : ${r.cmd}`);
        console.log(`  roles    : ${Array.isArray(r.roles) ? r.roles.join(", ") : r.roles}`);
        console.log(`  qual     : ${r.qual ?? "(none)"}`);
        console.log(`  with_check: ${r.with_check ?? "(none)"}`);
      }
    }

    // --- [3] GRANTS -----------------------------------------------------------
    header("3. GRANTS  (aclexplode(relacl) — anon / authenticated / service_role)");
    {
      const res = await pg.query(
        `select table_name, grantee_role, privilege_type
           from (
             select c.relname                        as table_name,
                    e.grantee::regrole::text          as grantee_role,
                    e.privilege_type                  as privilege_type
               from pg_class c
               join pg_namespace n on n.oid = c.relnamespace
               cross join lateral aclexplode(c.relacl) e
              where n.nspname = 'public' and c.relname = any($1)
           ) sub
          where grantee_role in ('anon', 'authenticated', 'service_role')
          order by table_name, grantee_role, privilege_type`,
        [TABLES]
      );
      if (res.rowCount === 0) console.log("  (no grants to anon/authenticated/service_role)");
      let lastTable = "";
      for (const r of res.rows) {
        if (r.table_name !== lastTable) {
          console.log(`\n  ${r.table_name}`);
          lastTable = r.table_name;
        }
        console.log(`    ${r.grantee_role.padEnd(14)} ${r.privilege_type}`);
      }
    }

    // --- [4] TRIGGERS ---------------------------------------------------------
    header("4. TRIGGERS  (pg_trigger where tgisinternal = false)");
    {
      const res = await pg.query(
        `select c.relname                as table_name,
                t.tgname                  as trigger_name,
                p.proname                 as function_name,
                pg_get_triggerdef(t.oid)  as definition
           from pg_trigger t
           join pg_class c     on c.oid = t.tgrelid
           join pg_namespace n on n.oid = c.relnamespace
           join pg_proc p      on p.oid = t.tgfoid
          where n.nspname = 'public' and c.relname = any($1) and not t.tgisinternal
          order by c.relname, t.tgname`,
        [TABLES]
      );
      if (res.rowCount === 0) console.log("  (no non-internal triggers on the target tables)");
      let lastTable = "";
      for (const r of res.rows) {
        if (r.table_name !== lastTable) {
          console.log(`\n  ${r.table_name}`);
          lastTable = r.table_name;
        }
        console.log(`    trigger : ${r.trigger_name}`);
        console.log(`    executes: ${r.function_name}`);
        console.log(`    def     : ${r.definition}`);
      }
    }

    // --- [5] FUNCTION BODIES --------------------------------------------------
    header("5. FUNCTION BODIES  (every function in schema private — pg_get_functiondef)");
    {
      // Enumerate ALL of schema private, not a hardcoded list — so a helper added
      // in another workstream (e.g. auth_user_has_permission) can never escape.
      const res = await pg.query(
        `select p.proname                 as function_name,
                pg_get_functiondef(p.oid) as definition
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'private'
          order by p.proname, p.oid`
      );
      console.log(`  ${res.rowCount} function(s) in schema private.`);
      if (res.rowCount === 0) console.log("  (schema private has no functions)");
      for (const r of res.rows) {
        sub(`private.${r.function_name}`);
        console.log(r.definition);
      }
    }

    // --- [6] COLUMN DEFAULTS + VISIBILITY CHECK CONSTRAINTS -------------------
    header("6. COLUMN DEFAULTS  (visibility default + its CHECK constraint)");
    {
      const defaults = await pg.query(
        `select table_name, column_default
           from information_schema.columns
          where table_schema = 'public'
            and table_name = any($1)
            and column_name = 'visibility'
          order by table_name`,
        [TABLES]
      );
      sub("visibility column defaults (information_schema.columns)");
      if (defaults.rowCount === 0) console.log("  (no target table has a visibility column)");
      for (const r of defaults.rows) {
        console.log(`  ${r.table_name.padEnd(18)} default = ${r.column_default ?? "(none)"}`);
      }

      const checks = await pg.query(
        `select c.relname                    as table_name,
                con.conname                   as constraint_name,
                pg_get_constraintdef(con.oid) as definition
           from pg_constraint con
           join pg_class c     on c.oid = con.conrelid
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relname = any($1)
            and con.contype = 'c'
            and pg_get_constraintdef(con.oid) ilike '%visibility%'
          order by c.relname, con.conname`,
        [TABLES]
      );
      sub("visibility CHECK constraints (pg_constraint / pg_get_constraintdef)");
      if (checks.rowCount === 0) console.log("  (no CHECK constraint references visibility)");
      for (const r of checks.rows) {
        console.log(`  ${r.table_name} — ${r.constraint_name}`);
        console.log(`    ${r.definition}`);
      }
    }

    await pg.query("commit");
    console.log("\n" + "=".repeat(78));
    console.log(`AUDIT COMPLETE (read-only) — host: ${host ?? "(unparseable)"}`);
    console.log("=".repeat(78) + "\n");
  } finally {
    await pg.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("AUDIT FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
