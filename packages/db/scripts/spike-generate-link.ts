/**
 * ⚠️ SPIKE — THROWAWAY. NOT part of the verify suite. DELETE after the
 * generateLink feasibility question is answered.
 *
 * Question under test: can `auth.admin.generateLink` mint a usable login link
 * with NO SMTP configured — i.e. does the link come back in the RESPONSE
 * (server-side, for us to deliver however we like), or does it depend on
 * GoTrue sending mail?
 *
 * For each of type = "recovery" | "magiclink" | "invite" (against the seeded
 * user1@organizationA.com) this reports:
 *   - error (exact message) or success
 *   - whether data.properties.action_link exists, and its SHAPE (path + query
 *     param NAMES; the token value itself is redacted)
 *   - hashed_token / verification_type / redirect_to / email_otp presence,
 *     and any expiry-looking field
 *   - wall-clock duration of the call (does it block on mail?)
 *   - whether the local mail catcher (Mailpit, port 54324) received anything
 *     new because of the call
 *
 * Run:  pnpm --filter @platform/db exec tsx scripts/spike-generate-link.ts
 * (with the local-stack env override; the guard below refuses anything else)
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

import { assertLocalDatabase } from "./db-guard";

// FIRST statement: refuse to run against a non-local database. This script
// WRITES (generateLink stamps recovery/confirmation tokens on the auth user).
assertLocalDatabase("spike-generate-link.ts");

const rootEnv = resolve(process.cwd(), "../../.env");
dotenv.config({ path: existsSync(rootEnv) ? rootEnv : undefined });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;
if (!URL || !SECRET) throw new Error("Missing Supabase env in root .env");

const TARGET_EMAIL = "user1@organizationa.com"; // seeded (Supabase lowercases emails)
const MAILPIT = "http://127.0.0.1:54324";

/** Message count in the local mail catcher (Mailpit API). Null if unreachable. */
async function mailCount(): Promise<number | null> {
  try {
    const res = await fetch(`${MAILPIT}/api/v1/messages?limit=1`);
    if (!res.ok) return null;
    const body = (await res.json()) as { total?: number };
    return typeof body.total === "number" ? body.total : null;
  } catch {
    return null;
  }
}

/** Redact a link: keep origin + path + query param NAMES, hide values. */
function describeLink(raw: string): string {
  try {
    const u = new globalThis.URL(raw);
    const params = [...u.searchParams.keys()];
    return `${u.origin}${u.pathname} ? params: [${params.join(", ")}]`;
  } catch {
    return "(unparseable URL)";
  }
}

async function main(): Promise<void> {
  const admin = createClient(URL!, SECRET!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("\n=== spike: auth.admin.generateLink with NO SMTP configured ===");
  console.log(`target user: ${TARGET_EMAIL}`);
  console.log(`mail catcher: ${MAILPIT} (Mailpit)`);

  for (const type of ["recovery", "magiclink", "invite"] as const) {
    console.log(`\n--- type: "${type}" ---`);
    const before = await mailCount();
    const t0 = Date.now();
    const { data, error } = await admin.auth.admin.generateLink({
      type,
      email: TARGET_EMAIL,
    });
    const ms = Date.now() - t0;
    // Small grace period so an async mail send (if any) can land in Mailpit.
    await new Promise((r) => setTimeout(r, 1500));
    const after = await mailCount();

    console.log(`duration: ${ms}ms (did not block noticeably: ${ms < 3000})`);
    if (before === null || after === null) {
      console.log("mailpit: UNREACHABLE — cannot judge mail side-effects");
    } else {
      console.log(
        `mailpit messages: before=${before} after=${after} → ${
          after > before ? "MAIL WAS SENT/CAUGHT" : "no mail attempted"
        }`,
      );
    }

    if (error) {
      console.log(`error: ${JSON.stringify(error.message)} (status ${String((error as { status?: number }).status)})`);
      continue;
    }

    const p = data.properties;
    if (!p || !p.action_link) {
      console.log("no error, but NO action_link in data.properties:", JSON.stringify(p));
      continue;
    }
    console.log(`action_link: ${describeLink(p.action_link)}`);
    console.log(`  hashed_token present: ${Boolean(p.hashed_token)} (${p.hashed_token ? `${p.hashed_token.slice(0, 8)}…, ${p.hashed_token.length} chars` : "-"})`);
    console.log(`  verification_type: ${p.verification_type}`);
    console.log(`  redirect_to: ${p.redirect_to}`);
    console.log(`  email_otp present: ${Boolean(p.email_otp)}${p.email_otp ? ` (${p.email_otp.length} digits)` : ""}`);
    // Any expiry-looking fields, wherever they live.
    const expiryKeys = Object.keys(p).filter((k) => /expir|valid|ttl/i.test(k));
    console.log(`  expiry-ish fields on properties: ${expiryKeys.length ? expiryKeys.join(", ") : "none"}`);
    if (data.user) {
      const u = data.user as unknown as Record<string, unknown>;
      const stamps = ["recovery_sent_at", "confirmation_sent_at", "invited_at", "email_confirmed_at"]
        .filter((k) => u[k])
        .map((k) => `${k}=${String(u[k])}`);
      console.log(`  user stamps: ${stamps.length ? stamps.join(" | ") : "none set"}`);
    }
  }

  // --- FOLLOW one link end to end: what does /auth/v1/verify hand the app? ---
  // Mint a FRESH recovery link (the ones above may be superseded) and hit it
  // without a browser, redirect: manual, to see the exact Location the app's
  // redirect target would receive. Param VALUES are redacted; names only.
  console.log("--- following a fresh recovery link (redirect: manual) ---");
  const fresh = await admin.auth.admin.generateLink({ type: "recovery", email: TARGET_EMAIL });
  if (fresh.error || !fresh.data.properties?.action_link) {
    console.log(`could not mint follow-up link: ${fresh.error?.message ?? "no action_link"}`);
  } else {
    const res = await fetch(fresh.data.properties.action_link, { redirect: "manual" });
    const loc = res.headers.get("location");
    console.log(`verify endpoint responded: HTTP ${res.status}`);
    if (loc) {
      const u = new globalThis.URL(loc);
      const queryKeys = [...u.searchParams.keys()];
      const fragKeys = u.hash
        ? u.hash
            .slice(1)
            .split("&")
            .map((kv) => kv.split("=")[0])
        : [];
      console.log(`redirect Location: ${u.origin}${u.pathname}`);
      console.log(`  query params: [${queryKeys.join(", ")}]`);
      console.log(`  fragment params: [${fragKeys.join(", ")}]`);
    } else {
      console.log("no Location header — body follows (truncated):");
      console.log((await res.text()).slice(0, 300));
    }
  }

  console.log(
    "\n(reminder: otp_expiry in config.toml is 3600s — links/OTPs die an hour after issue;" +
      "\n rate limit email_sent=2/h applies only when SMTP is enabled — check whether it" +
      "\n gated these calls above.)\n",
  );
}

main().catch((err: unknown) => {
  console.error("SPIKE FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
