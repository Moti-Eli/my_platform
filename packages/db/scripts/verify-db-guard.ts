/**
 * Verification harness for the local-database guard (scripts/db-guard.ts).
 *
 * -----------------------------------------------------------------------------
 * WHAT THIS EXISTS TO PIN DOWN
 * -----------------------------------------------------------------------------
 * The guard is the only thing standing between a careless `pnpm seed` and the LIVE
 * remote project — a trap that has already sprung once (fixtures were written to
 * the real project and removed by hand). So the guard's decision must be tested,
 * not assumed.
 *
 * THE LOAD-BEARING ASSERTION is [6]: `https://localhost.evil.supabase.co` CONTAINS
 * the substring "localhost" and is REMOTE. Any guard written with `url.includes
 * ("localhost")` waves it through. This one parses the host and compares it, and [6]
 * is what proves it — the difference between a guard and the appearance of one.
 *
 * Connects to NOTHING. It calls the pure decision function (`evaluateTargets`)
 * directly with synthetic targets, so it is fast, deterministic, and cannot itself
 * touch a database — which would be an absurd way to test a guard against touching
 * databases.
 *
 * Run:  pnpm --filter @platform/db exec tsx scripts/verify-db-guard.ts
 */
import {
  evaluateTargets,
  isLocalHost,
  hostOf,
  LOCAL_DB_URL,
  ESCAPE_HATCH_VALUE,
  type DbTarget,
} from "./db-guard";

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { passed++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const REMOTE = "https://ymntmaexample.supabase.co";
const LOCAL_API = "http://127.0.0.1:54321";

/** One supabase-url target + a known-local db url, so only the first is in play. */
function supa(value: string | undefined): DbTarget[] {
  return [
    { variable: "NEXT_PUBLIC_SUPABASE_URL", value },
    { variable: "SUPABASE_DB_URL", value: LOCAL_DB_URL },
  ];
}

function main(): void {
  console.log("\n[1] A local URL passes");
  check("http://127.0.0.1:54321 is allowed", evaluateTargets(supa(LOCAL_API), undefined).allowed);
  check("http://localhost:54321 is allowed", evaluateTargets(supa("http://localhost:54321"), undefined).allowed);
  check("the default SUPABASE_DB_URL literal is local", evaluateTargets(supa(LOCAL_API), undefined).allowed,
    LOCAL_DB_URL);
  check("a *.local mDNS host is allowed", evaluateTargets(supa("http://my-box.local:54321"), undefined).allowed);

  console.log("\n[2] A remote supabase.co URL REFUSES");
  const r = evaluateTargets(supa(REMOTE), undefined);
  check("https://<ref>.supabase.co is refused", !r.allowed, r.reason);
  check("...and the refusal names the offending variable", r.offending?.variable === "NEXT_PUBLIC_SUPABASE_URL",
    r.offending?.variable ?? "(none)");
  check("...and names the host it resolved to", r.offending?.host === "ymntmaexample.supabase.co",
    r.offending?.host ?? "(none)");

  console.log("\n[3] An UNSET url REFUSES (fail closed — unset is not a pass)");
  const unset = evaluateTargets(supa(undefined), undefined);
  check("undefined is refused", !unset.allowed, unset.reason);
  check("empty string is refused", !evaluateTargets(supa(""), undefined).allowed);
  check("whitespace-only is refused", !evaluateTargets(supa("   "), undefined).allowed);
  check("a remote SUPABASE_DB_URL is refused even when the API url is local",
    !evaluateTargets(
      [
        { variable: "NEXT_PUBLIC_SUPABASE_URL", value: LOCAL_API },
        { variable: "SUPABASE_DB_URL", value: "postgresql://u:p@db.ymntmaexample.supabase.co:5432/postgres" },
      ],
      undefined
    ).allowed,
    "every target must be local, not just the first"
  );
  check("declaring NO targets is refused", !evaluateTargets([], undefined).allowed);

  console.log("\n[4] The escape hatch, with the EXACT string, allows a remote URL");
  const esc = evaluateTargets(supa(REMOTE), ESCAPE_HATCH_VALUE);
  check(`ALLOW_REMOTE_DB_WRITES=${ESCAPE_HATCH_VALUE} allows remote`, esc.allowed, esc.reason);
  check("...and the verdict records that it went via the hatch", esc.viaEscapeHatch === true);

  console.log("\n[5] The escape hatch is an EXACT match — truthy values still REFUSE");
  for (const v of ["1", "true", "yes", "TRUE", "I-UNDERSTAND", "i-understand ", " i-understand", "i_understand", "y"]) {
    check(`ALLOW_REMOTE_DB_WRITES=${JSON.stringify(v)} still refuses`, !evaluateTargets(supa(REMOTE), v).allowed);
  }

  console.log("\n[6] THE LOAD-BEARING ONE: 'localhost' as a SUBSTRING of a remote host REFUSES");
  const evil = "https://localhost.evil.supabase.co";
  const ev = evaluateTargets(supa(evil), undefined);
  check(`${evil} is REFUSED`, !ev.allowed, ev.reason);
  check("...the host parsed to the real remote host, not 'localhost'",
    ev.offending?.host === "localhost.evil.supabase.co", ev.offending?.host ?? "(none)");
  check("isLocalHost('localhost.evil.supabase.co') is false", !isLocalHost("localhost.evil.supabase.co"),
    "a substring match would have returned true here");
  for (const evilUrl of [
    "https://127.0.0.1.evil.supabase.co",
    "https://evil.supabase.co/?localhost",
    "https://evil.supabase.co#127.0.0.1",
    "https://evil.supabase.co/localhost",
    "https://notlocalhost.supabase.co",
    "https://localhost-x.supabase.co",
    "https://my.local.supabase.co",
  ]) {
    check(`${evilUrl} is REFUSED`, !evaluateTargets(supa(evilUrl), undefined).allowed,
      `host=${hostOf(evilUrl)}`);
  }
  check("a user@host credential trick does not fool the parser",
    !evaluateTargets(supa("https://localhost@evil.supabase.co"), undefined).allowed,
    `host=${hostOf("https://localhost@evil.supabase.co")}`);

  console.log("\n[7] Unparseable input is refused, never assumed safe");
  for (const bad of ["not a url", "://", "localhost:54321", "/tmp/socket"]) {
    check(`${JSON.stringify(bad)} is refused`, !evaluateTargets(supa(bad), undefined).allowed);
  }

  console.log("\n[8] Genuine local hosts still pass (the guard is not refusing everything)");
  for (const good of [
    "http://localhost:3000",
    "http://127.0.0.1:54321",
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    "postgres://postgres:postgres@localhost:54322/postgres",
    "http://[::1]:54321",
  ]) {
    check(`${good} is allowed`, evaluateTargets(supa(good), undefined).allowed, `host=${hostOf(good)}`);
  }

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
