/**
 * HTTP smoke check for the chat PAGE (server render + guard + RTL) against the
 * running dev server. The realtime socket behavior is covered separately by
 * verify-chat-realtime.ts; this confirms the page itself renders/guards.
 *
 * Prereq: `pnpm --filter @platform/web dev` running + seeded.
 * Run:    pnpm --filter @platform/db exec tsx scripts/verify-chat-http.ts
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { createServerClient } from "@supabase/ssr";

const rootEnv = resolve(process.cwd(), "../../.env");
dotenv.config({ path: existsSync(rootEnv) ? rootEnv : undefined });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!URL || !ANON) throw new Error("Missing Supabase env in root .env");
const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const PW = "123456";

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { passed++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

async function sessionCookie(email: string): Promise<string> {
  const jar = new Map<string, string>();
  const client = createServerClient(URL!, ANON!, {
    cookies: {
      getAll: () => Array.from(jar, ([name, value]) => ({ name, value })),
      setAll: (toSet) => { for (const { name, value } of toSet) jar.set(name, value); },
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  return Array.from(jar, ([n, v]) => `${n}=${v}`).join("; ");
}

async function get(path: string, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });
  const body = res.status === 200 ? await res.text() : "";
  return { status: res.status, location: res.headers.get("location"), body };
}

async function main(): Promise<void> {
  try { await fetch(`${BASE}/en`, { redirect: "manual" }); }
  catch { throw new Error(`Dev server not reachable at ${BASE}.`); }

  console.log("\n[unauthenticated] /en/dashboard/chat");
  const anon = await get("/en/dashboard/chat");
  check("redirected to login", anon.status >= 300 && anon.status < 400 && (anon.location ?? "").includes("/login"),
    `status=${anon.status} location=${anon.location}`);

  console.log("\n[member] /en/dashboard/chat");
  const cookie = await sessionCookie("admin1@organizationA.com");
  const en = await get("/en/dashboard/chat", cookie);
  check("renders 200 for a logged-in member", en.status === 200, `status=${en.status}`);
  check("renders the composer (Write a message)", en.body.includes("Write a message"));
  check("shows the active org name (Organization A)", en.body.includes("Organization A"));

  console.log("\n[RTL] /he/dashboard/chat");
  const he = await get("/he/dashboard/chat", cookie);
  check("renders 200 in Hebrew", he.status === 200, `status=${he.status}`);
  check('document direction is RTL (dir="rtl")', /<html[^>]*\bdir="rtl"/.test(he.body));
  check("renders Hebrew chat title (צ׳אט)", he.body.includes("צ׳אט"));

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error("VERIFY FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
