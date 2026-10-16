/**
 * Refuse to run a writing script against anything but a LOCAL database.
 *
 * -----------------------------------------------------------------------------
 * WHY THIS EXISTS (it is not hypothetical)
 * -----------------------------------------------------------------------------
 * The root `.env` points NEXT_PUBLIC_SUPABASE_URL at the REMOTE Supabase project,
 * while `SUPABASE_DB_URL` is unset and therefore defaults to the local stack. A
 * harness run in that state is SPLIT-BRAINED: fixtures go to the remote project
 * over supabase-js while the pg assertions run against local. That happened — test
 * organizations and users were created on the live project and had to be removed by
 * hand. The fix at the time was a per-run env override, which protects only the
 * person who remembers to type it. This module disarms the trap for everyone.
 *
 * `seed.ts` is the worst case: it creates auth users with a known shared password.
 *
 * -----------------------------------------------------------------------------
 * THE RULE
 * -----------------------------------------------------------------------------
 * Every URL a writing script will use must resolve to a LOCAL host. Anything else
 * refuses, loudly, naming the variable and the value it resolved to.
 *
 * FAIL CLOSED. An unset/blank variable is NOT a pass — it is a refusal. The single
 * exception is SUPABASE_DB_URL, which does not refuse when unset because it does
 * not stay unset: every script falls back to the same hard-coded local literal, so
 * it resolves to a KNOWN-LOCAL value. That is the guard resolving a default, not a
 * missing variable slipping through — the default lives here (LOCAL_DB_URL) so the
 * guard judges the exact string the caller will connect with.
 *
 * HOSTS ARE PARSED, NEVER SUBSTRING-MATCHED. `https://localhost.evil.supabase.co`
 * contains "localhost" and is REMOTE. A substring check would wave it through; this
 * module extracts the hostname and compares it exactly (or by the `.local` suffix).
 *
 * IT REFUSES; IT DOES NOT REDIRECT. Someone pointed at remote gets an error telling
 * them to point at local — never a silent reroute to a database they did not ask
 * for. Nothing here writes or reads any env file.
 *
 * -----------------------------------------------------------------------------
 * ESCAPE HATCH
 * -----------------------------------------------------------------------------
 * ALLOW_REMOTE_DB_WRITES=i-understand — an EXACT string match. Not a truthy check:
 * `1`, `true`, `yes` all still refuse, so the bypass cannot be tripped by the usual
 * reflexes or by a CI system that helpfully sets flags to "1". Nothing in this repo
 * sets it; it exists so a human can type it deliberately, having read this.
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import dotenv from "dotenv";

// Load the root .env before reading anything, so this module is safe to call as a
// script's first statement. dotenv does not override already-set vars, so a
// caller's own dotenv.config() and this one cannot disagree.
const rootEnv = resolve(process.cwd(), "../../.env");
dotenv.config({ path: existsSync(rootEnv) ? rootEnv : undefined });

/** The local-stack fallback every script uses when SUPABASE_DB_URL is unset. */
export const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/** The escape hatch's variable and its ONLY accepted value (exact match). */
export const ESCAPE_HATCH_VAR = "ALLOW_REMOTE_DB_WRITES";
export const ESCAPE_HATCH_VALUE = "i-understand";

export interface DbTarget {
  /** The env var's name, for the error message. */
  variable: string;
  /** The value the caller will actually use (already defaulted, if it defaults). */
  value: string | undefined;
}

export interface GuardVerdict {
  allowed: boolean;
  /** Human-readable explanation; the refusal message when allowed is false. */
  reason: string;
  /** Set when a specific target caused the refusal. */
  offending?: { variable: string; value: string; host: string | null };
  /** True when a remote target was permitted only by the escape hatch. */
  viaEscapeHatch?: boolean;
}

/**
 * Extract the hostname from a URL. Returns null when it cannot be parsed as one —
 * which the caller must treat as NOT local (fail closed), never as "probably fine".
 *
 * Handles postgres:// and postgresql:// as well as http(s)://: WHATWG URL parses
 * non-special schemes and still exposes `hostname`.
 */
export function hostOf(url: string): string | null {
  try {
    const host = new globalThis.URL(url.trim()).hostname;
    if (!host) return null;
    // IPv6 hostnames arrive bracketed ("[::1]"); normalize for comparison.
    return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  } catch {
    return null;
  }
}

/**
 * Is this HOSTNAME (already parsed — never a raw URL) a local one?
 *
 * Exact matches plus the `.local` mDNS suffix. Deliberately NOT a substring test:
 * "localhost.evil.supabase.co" must be false, and it is, because it equals none of
 * these and its suffix is ".co".
 */
export function isLocalHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0") return true;
  // ".local" mDNS names (e.g. "my-box.local"). ".local" alone is not a host.
  return h.endsWith(".local") && h.length > ".local".length;
}

/** Is this full URL local? False for anything unparseable (fail closed). */
export function isLocalUrl(url: string): boolean {
  const host = hostOf(url);
  return host === null ? false : isLocalHost(host);
}

/**
 * The decision function — pure, no I/O, no connections. `verify-db-guard.ts` tests
 * this directly.
 *
 * @param targets every URL the caller will use, already resolved to its final value
 * @param escapeHatch the raw value of ALLOW_REMOTE_DB_WRITES (exact match required)
 */
export function evaluateTargets(targets: DbTarget[], escapeHatch: string | undefined): GuardVerdict {
  if (targets.length === 0) {
    return { allowed: false, reason: "No database targets were declared — refusing (fail closed)." };
  }

  for (const t of targets) {
    const value = (t.value ?? "").trim();

    // Fail closed: unset/blank is a refusal, not a pass.
    if (value === "") {
      if (escapeHatch === ESCAPE_HATCH_VALUE) continue;
      return {
        allowed: false,
        reason: `${t.variable} is not set. Refusing to guess which database that means (fail closed).`,
        offending: { variable: t.variable, value: "(unset)", host: null },
      };
    }

    if (isLocalUrl(value)) continue;

    const host = hostOf(value);
    if (escapeHatch === ESCAPE_HATCH_VALUE) {
      return {
        allowed: true,
        viaEscapeHatch: true,
        reason: `${ESCAPE_HATCH_VAR}=${ESCAPE_HATCH_VALUE} set — proceeding against NON-LOCAL ${t.variable} (${host ?? "unparseable"}).`,
        offending: { variable: t.variable, value, host },
      };
    }

    return {
      allowed: false,
      reason:
        host === null
          ? `${t.variable} is not a parseable URL, so it cannot be confirmed local.`
          : `${t.variable} points at "${host}", which is not a local host.`,
      offending: { variable: t.variable, value, host },
    };
  }

  return { allowed: true, reason: "All database targets resolve to a local host." };
}

/** Redact credentials before echoing a URL back to the terminal. */
function safeToPrint(value: string): string {
  return value.replace(/\/\/[^@/]*@/, "//***:***@");
}

/**
 * The targets a script will use. NEXT_PUBLIC_SUPABASE_URL must be set;
 * SUPABASE_DB_URL resolves to the known-local literal when unset.
 */
export function currentTargets(): DbTarget[] {
  return [
    { variable: "NEXT_PUBLIC_SUPABASE_URL", value: process.env.NEXT_PUBLIC_SUPABASE_URL },
    { variable: "SUPABASE_DB_URL", value: process.env.SUPABASE_DB_URL ?? LOCAL_DB_URL },
  ];
}

/**
 * Guard a writing script. Call this as the FIRST statement, before any client is
 * constructed. Exits non-zero on refusal — it never returns a rejected verdict.
 */
export function assertLocalDatabase(scriptName: string): void {
  const verdict = evaluateTargets(currentTargets(), process.env[ESCAPE_HATCH_VAR]);

  if (verdict.allowed && verdict.viaEscapeHatch) {
    console.warn(
      `\n⚠  ${scriptName}: ${ESCAPE_HATCH_VAR} is set. Writing to a NON-LOCAL database.` +
        `\n   ${verdict.offending?.variable} = ${safeToPrint(verdict.offending?.value ?? "")}\n`
    );
    return;
  }
  if (verdict.allowed) return;

  const o = verdict.offending;
  console.error(
    `\n✗ REFUSING TO RUN ${scriptName} — this script WRITES to the database.\n` +
      `\n  ${verdict.reason}\n` +
      (o ? `  ${o.variable} = ${safeToPrint(o.value)}\n` : "") +
      `\n  This guard exists because harness fixtures were once written to the LIVE\n` +
      `  remote project and had to be removed by hand. Point your environment at the\n` +
      `  local stack (\`supabase start\`) and re-run — for example:\n` +
      `\n    NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \\\n` +
      `    SUPABASE_SECRET_KEY=<local secret from \`supabase status\`> \\\n` +
      `    pnpm --filter @platform/db exec tsx scripts/${scriptName}\n` +
      `\n  This guard REFUSES rather than redirecting: it will not silently send your\n` +
      `  writes somewhere you did not ask for.\n` +
      `\n  If you genuinely mean to write to a non-local database, set exactly:\n` +
      `    ${ESCAPE_HATCH_VAR}=${ESCAPE_HATCH_VALUE}\n`
  );
  process.exit(1);
}
