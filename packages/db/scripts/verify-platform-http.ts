/**
 * End-to-end HTTP verification of the PLATFORM-OWNER screen's SERVER-SIDE guard.
 *
 * Drives the REAL running dev server (`next dev` on BASE). For each role it signs
 * in with the SAME `@supabase/ssr` cookie format the app uses (so the cookies are
 * byte-identical to a real browser session), then GETs /en/platform and inspects
 * the actual server response — proving the guard is enforced server-side, not in
 * the client.
 *
 * Expected:
 *   - unauthenticated            -> redirect to /login
 *   - org admin (not an owner)   -> redirect to /dashboard
 *   - regular member             -> redirect to /dashboard
 *   - platform owner             -> 200, page lists all orgs (Org A + Org B)
 *
 * Prereq: `pnpm --filter @platform/web dev` is running and seeded.
 * Run:    pnpm --filter @platform/db exec tsx scripts/verify-platform-http.ts
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
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Sign in as `email` and return the Cookie header a browser would send. */
async function sessionCookie(email: string): Promise<string> {
  const jar = new Map<string, string>();
  const client = createServerClient(URL!, ANON!, {
    cookies: {
      getAll: () => Array.from(jar, ([name, value]) => ({ name, value })),
      setAll: (toSet) => {
        for (const { name, value } of toSet) jar.set(name, value);
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  return Array.from(jar, ([n, v]) => `${n}=${v}`).join("; ");
}

async function getPlatform(
  cookie?: string,
  locale = "en"
): Promise<{ status: number; location: string | null; body: string }> {
  const res = await fetch(`${BASE}/${locale}/platform`, {
    headers: cookie ? { cookie } : {},
    redirect: "manual",
  });
  const body = res.status === 200 ? await res.text() : "";
  return { status: res.status, location: res.headers.get("location"), body };
}

async function main(): Promise<void> {
  // Confirm the server is up.
  try {
    await fetch(`${BASE}/en`, { redirect: "manual" });
  } catch {
    throw new Error(`Dev server not reachable at ${BASE}. Start it with: pnpm --filter @platform/web dev`);
  }

  console.log("\n[unauthenticated] /en/platform");
  const anon = await getPlatform();
  check(
    "redirected to login (no session)",
    anon.status >= 300 && anon.status < 400 && (anon.location ?? "").includes("/login"),
    `status=${anon.status} location=${anon.location}`
  );

  console.log("\n[org admin — NOT a platform owner] /en/platform");
  const adminCookie = await sessionCookie("admin1@organizationA.com");
  const adminRes = await getPlatform(adminCookie);
  check(
    "redirected to dashboard (not an owner)",
    adminRes.status >= 300 && adminRes.status < 400 && (adminRes.location ?? "").includes("/dashboard"),
    `status=${adminRes.status} location=${adminRes.location}`
  );

  console.log("\n[regular member] /en/platform");
  const memberCookie = await sessionCookie("user1@organizationA.com");
  const memberRes = await getPlatform(memberCookie);
  check(
    "redirected to dashboard (not an owner)",
    memberRes.status >= 300 && memberRes.status < 400 && (memberRes.location ?? "").includes("/dashboard"),
    `status=${memberRes.status} location=${memberRes.location}`
  );

  console.log("\n[platform owner] /en/platform");
  const ownerCookie = await sessionCookie("owner@platform.test");
  const ownerRes = await getPlatform(ownerCookie);
  check("owner gets 200 (access granted)", ownerRes.status === 200, `status=${ownerRes.status}`);
  check("owner sees Organization A in the listing", ownerRes.body.includes("Organization A"));
  check("owner sees Organization B in the listing", ownerRes.body.includes("Organization B"));

  console.log("\n[RTL] owner on /he/platform");
  const ownerHe = await getPlatform(ownerCookie, "he");
  check("owner gets 200 in Hebrew locale", ownerHe.status === 200, `status=${ownerHe.status}`);
  check('document direction is RTL (dir="rtl")', /<html[^>]*\bdir="rtl"/.test(ownerHe.body));
  check("page renders Hebrew strings (פלטפורמה)", ownerHe.body.includes("פלטפורמה"));

  console.log("\n[RTL] non-owner on /he/platform");
  const adminHe = await getPlatform(adminCookie, "he");
  check(
    "org admin redirected to /he/dashboard",
    adminHe.status >= 300 && adminHe.status < 400 && (adminHe.location ?? "").includes("/he/dashboard"),
    `status=${adminHe.status} location=${adminHe.location}`
  );

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error("VERIFY FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
