/**
 * Verification for @platform/observability: structured logging, the default
 * (console-only, no reporter) behavior when SENTRY_DSN is unset, and — most
 * importantly — that NO secrets/passwords/tokens/keys/emails leak into logs.
 *
 * Run:  pnpm --filter @platform/db exec tsx scripts/verify-observability.ts
 */
import {
  logger,
  captureException,
  hasErrorReporter,
  redact,
} from "../../observability/src/index";

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { passed++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

// A context deliberately stuffed with sensitive values of every shape.
const SENSITIVE = {
  password: "hunter2-PLAINTEXT",
  token: "eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4",
  secretKey: "sb_secret_ABCDEFGHIJKLMNOPQRST",
  publishableKey: "sb_publishable_ZZZ999",
  authorization: "Bearer abc.def.ghijklmnop",
  email: "alice@example.com",
  emails: ["bob@x.com", "carol@y.com"],
  cookie: "sb-access-token=eyJhbGciOiJI.payload.sig",
  // Non-sensitive identifiers that SHOULD survive:
  userId: "11111111-uid",
  orgId: "22222222-oid",
  nested: { access_token: "nested-secret-AAA", note: "leak sb_secret_DEADBEEF11223344 here" },
};

const FORBIDDEN = [
  "hunter2-PLAINTEXT",
  "sb_secret_ABCDEFGHIJKLMNOPQRST",
  "sb_secret_DEADBEEF11223344",
  "sb_publishable_ZZZ999",
  "eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4",
  "abc.def.ghijklmnop",
  "alice@example.com",
  "bob@x.com",
  "nested-secret-AAA",
];

function captureConsole(fn: () => void): string {
  const lines: string[] = [];
  const methods = ["error", "warn", "info", "debug", "log"] as const;
  const orig: Record<string, unknown> = {};
  for (const m of methods) {
    orig[m] = console[m];
    console[m] = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  }
  try { fn(); } finally { for (const m of methods) (console[m] as unknown) = orig[m]; }
  return lines.join("\n");
}

function main(): void {
  console.log("\n[default behavior — SENTRY_DSN unset]");
  check("no error reporter registered by default", hasErrorReporter() === false);

  console.log("\n[structured logging shape]");
  const infoOut = captureConsole(() => logger.info("member added", { action: "addMember", userId: "u1", orgId: "o1" }));
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(infoOut); } catch { /* */ }
  check("info log is a single JSON line", infoOut.trim().startsWith("{") && infoOut.trim().endsWith("}"));
  check("has level/timestamp/msg fields", parsed.level === "info" && typeof parsed.timestamp === "string" && parsed.msg === "member added");

  console.log("\n[error capture with sensitive context]");
  const errOut = captureConsole(() =>
    captureException(new Error("boom while addMember"), { action: "addMember", ...SENSITIVE })
  );
  check("captured error message is logged", errOut.includes("boom while addMember"));
  check("error log includes an error object with a stack", errOut.includes('"stack"'));

  const all = infoOut + "\n" + errOut;
  console.log("\n[SECURITY — no secret/PII leakage]");
  for (const f of FORBIDDEN) {
    check(`scrubbed: ${f.slice(0, 22)}…`, !all.includes(f));
  }
  console.log("\n[non-sensitive identifiers survive]");
  check("logs userId", all.includes("11111111-uid"));
  check("logs orgId", all.includes("22222222-oid"));

  console.log("\n[redact() spot checks]");
  const r = redact(SENSITIVE) as Record<string, unknown>;
  check("password key -> [redacted]", r.password === "[redacted]");
  check("authorization key -> [redacted]", r.authorization === "[redacted]");
  check("email key -> [redacted]", r.email === "[redacted]");
  check("publishable VALUE redacted by pattern", String((redact({ k: SENSITIVE.publishableKey }) as { k: string }).k).includes("[redacted"));
  check("nested note has secret-key scrubbed", !JSON.stringify(r.nested).includes("DEADBEEF"));

  console.log("\n--- EXAMPLE STRUCTURED LOG LINES (what you'd see in the console) ---");
  // Restore real console for these (printed for the human).
  logger.info("organization created", { action: "createOrganization", actorId: "u-123", organizationId: "o-789" });
  logger.warn("membership_roles write denied", { action: "updateMemberRole", organizationId: "o-789", code: "42501" });
  captureException(new Error("example failure"), { action: "addMember", organizationId: "o-789", email: "should-not-appear@x.com" });

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
