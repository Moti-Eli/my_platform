// Verification harness for the mobile-facing admin API endpoints.
// Run against `pnpm --filter @platform/web dev` on http://localhost:3000.
// Reads Supabase config from apps/web/.env.local. Creates + cleans up test data.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(ROOT, "apps/web/.env.local"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET = env.SUPABASE_SECRET_KEY;
const BASE = "http://localhost:3000";
const PW = "123456";
const stamp = Date.now();

const results = [];
const ok = (name, pass, detail = "") => results.push({ name, pass, detail });

async function j(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function signIn(email) {
  const res = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  });
  const body = await j(res);
  if (!res.ok || !body?.access_token) throw new Error(`signIn ${email} failed: ${res.status}`);
  return { token: body.access_token, userId: body.user.id };
}

const adminHeaders = { apikey: SECRET, authorization: `Bearer ${SECRET}`, "content-type": "application/json" };
const restGet = async (path) => j(await fetch(`${URL}/rest/v1/${path}`, { headers: adminHeaders }));
const orgsFor = async (token) =>
  j(await fetch(`${URL}/rest/v1/organizations?select=id,name`, { headers: { apikey: ANON, authorization: `Bearer ${token}` } }));

const postMembers = (token, body) =>
  fetch(`${BASE}/api/admin/members`, {
    method: "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const postOrgs = (token, body) =>
  fetch(`${BASE}/api/admin/organizations`, {
    method: "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    body: JSON.stringify(body),
  });

// Supabase normalizes (lowercases) stored emails — match that here.
const userByEmail = async (email) =>
  (await restGet(`users?select=id,email&email=eq.${encodeURIComponent(email.toLowerCase())}`)) ?? [];
const deleteAuthUser = (id) => fetch(`${URL}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: adminHeaders });
const deleteOrg = (id) => fetch(`${URL}/rest/v1/organizations?id=eq.${id}`, { method: "DELETE", headers: adminHeaders });

async function main() {
  // --- Setup: sign in the cast, discover org ids -------------------------------
  const orgAAdmin = await signIn("admin1@organizationA.com");
  const orgBAdmin = await signIn("admin1@organizationB.com");
  const member = await signIn("user1@organizationA.com");
  const owner = await signIn("owner@platform.test");
  const orgA = (await orgsFor(orgAAdmin.token))[0];
  const orgB = (await orgsFor(orgBAdmin.token))[0];
  if (!orgA?.id || !orgB?.id) throw new Error("could not resolve org ids");

  // === GET /api/admin/organizations (platform owner orgs list) ================
  const getOrgs = (token) =>
    fetch(`${BASE}/api/admin/organizations`, {
      method: "GET",
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  {
    const g1 = await getOrgs(null);
    const g1b = await j(g1);
    ok("G1. GET no token -> 401", g1.status === 401 && g1b?.error === "unauthorized", `status=${g1.status} error=${g1b?.error}`);

    const g2 = await getOrgs(orgAAdmin.token);
    const g2b = await j(g2);
    ok("G2. GET non-owner -> 403", g2.status === 403 && g2b?.error === "notAllowed", `status=${g2.status} error=${g2b?.error}`);

    const g3 = await getOrgs(owner.token);
    const g3b = await j(g3);
    const list = g3b?.organizations ?? [];
    const hasSeeded = list.some((o) => o.id === orgA.id) && list.some((o) => o.id === orgB.id);
    const shape = list.every(
      (o) =>
        typeof o.id === "string" &&
        typeof o.name === "string" &&
        typeof o.memberCount === "number" &&
        typeof o.createdAt === "string"
    );
    ok("G3. GET owner -> 200 with seeded orgs", g3.status === 200 && hasSeeded && shape, `status=${g3.status} count=${list.length}`);
  }

  if (process.argv.includes("--get-only")) return printReport();

  const created = []; // {type, id} for cleanup

  // 1) No Authorization header -> 401, no side effects.
  {
    const email = `t1_${stamp}@organizationA.com`;
    const res = await postMembers(null, { email, displayName: "T1", targetRole: "member", organizationId: orgA.id });
    const b = await j(res);
    const noUser = (await userByEmail(email)).length === 0;
    ok("1. No auth header -> 401, no side effect", res.status === 401 && b?.error === "unauthorized" && noUser, `status=${res.status} error=${b?.error}`);
  }

  // 2) Garbage / malformed token -> 401.
  {
    const res = await postMembers("garbage.token.value", { email: `t2_${stamp}@a.com`, displayName: "T2", targetRole: "member", organizationId: orgA.id });
    const b = await j(res);
    ok("2. Garbage/expired token -> 401", res.status === 401 && b?.error === "unauthorized", `status=${res.status} error=${b?.error}`);
  }

  // 3) Valid member (no members.manage) -> 403, no user created.
  {
    const email = `t3_${stamp}@organizationA.com`;
    const res = await postMembers(member.token, { email, displayName: "T3", targetRole: "member", organizationId: orgA.id });
    const b = await j(res);
    const noUser = (await userByEmail(email)).length === 0;
    ok("3. Member (no members.manage) -> 403, no user", res.status === 403 && b?.error === "notAllowed" && noUser, `status=${res.status} error=${b?.error} created=${!noUser}`);
  }

  // 4) Org A admin targeting Org B -> 403 (tenant isolation), no user created.
  {
    const email = `t4_${stamp}@organizationB.com`;
    const res = await postMembers(orgAAdmin.token, { email, displayName: "T4", targetRole: "member", organizationId: orgB.id });
    const b = await j(res);
    const noUser = (await userByEmail(email)).length === 0;
    ok("4. Org A admin -> Org B -> 403, no user (isolation)", res.status === 403 && b?.error === "notAllowed" && noUser, `status=${res.status} error=${b?.error} created=${!noUser}`);
  }

  // 5) Org A admin -> Org A -> 200, user created w/ membership+role; dup -> 409, no half-provision.
  {
    const email = `t5_${stamp}@organizationA.com`;
    const res = await postMembers(orgAAdmin.token, { email, displayName: "T5 User", targetRole: "member", organizationId: orgA.id });
    const b = await j(res);
    let pass = res.status === 200 && b?.ok === true && typeof b?.userId === "string";
    let detail = `status=${res.status} userId=${b?.userId}`;
    if (b?.userId) created.push({ type: "user", id: b.userId });
    if (pass) {
      const m = (await restGet(`memberships?select=id&user_id=eq.${b.userId}&organization_id=eq.${orgA.id}`)) ?? [];
      const mr = m[0] ? (await restGet(`membership_roles?select=role_id&membership_id=eq.${m[0].id}`)) ?? [] : [];
      pass = m.length === 1 && mr.length === 1;
      detail += ` membership=${m.length} roles=${mr.length}`;
    }
    ok("5a. Org A admin -> Org A -> 200, provisioned (membership+role)", pass, detail);

    // duplicate email -> 409, original user still intact (no half-provision/no dup)
    const dup = await postMembers(orgAAdmin.token, { email, displayName: "T5 Dup", targetRole: "member", organizationId: orgA.id });
    const db = await j(dup);
    const byEmail = (await userByEmail(email)).length;
    const original = b?.userId ? ((await restGet(`users?select=id&id=eq.${b.userId}`)) ?? []).length : 0;
    ok(
      "5b. Duplicate email -> 409, no half-provision",
      dup.status === 409 && db?.error === "emailExists" && original === 1 && byEmail === 1,
      `status=${dup.status} error=${db?.error} originalUser=${original} byEmail=${byEmail}`
    );
  }

  // 6) Non-owner calling create-org -> 403, no org created.
  {
    const name = `T6 Org ${stamp}`;
    const res = await postOrgs(orgAAdmin.token, { organizationName: name, adminEmail: `t6_${stamp}@x.com`, adminDisplayName: "T6 Admin" });
    const b = await j(res);
    const orgs = (await restGet(`organizations?select=id&name=eq.${encodeURIComponent(name)}`)) ?? [];
    ok("6. Non-owner create-org -> 403, no org", res.status === 403 && b?.error === "notAllowed" && orgs.length === 0, `status=${res.status} error=${b?.error} orgs=${orgs.length}`);
  }

  // 7) Owner calling create-org -> 200, org + first admin created and functional.
  {
    const name = `T7 Org ${stamp}`;
    const adminEmail = `t7_${stamp}@neworg.com`;
    const res = await postOrgs(owner.token, { organizationName: name, adminEmail, adminDisplayName: "T7 Admin" });
    const b = await j(res);
    let pass = res.status === 200 && b?.ok === true && b?.organizationId && b?.adminUserId;
    let detail = `status=${res.status} orgId=${b?.organizationId}`;
    if (b?.adminUserId) created.push({ type: "user", id: b.adminUserId });
    if (b?.organizationId) created.push({ type: "org", id: b.organizationId });
    if (pass) {
      // functional: the new admin can sign in (dev temp password)
      let functional = false;
      try {
        await signIn(adminEmail);
        functional = true;
      } catch {
        functional = false;
      }
      const m = (await restGet(`memberships?select=id&user_id=eq.${b.adminUserId}&organization_id=eq.${b.organizationId}`)) ?? [];
      pass = functional && m.length === 1;
      detail += ` functional=${functional} membership=${m.length}`;
    }
    ok("7. Owner create-org -> 200, org+admin functional", pass, detail);
  }

  // 8) Oversized name -> 400 from validation; confirm DB CHECK also rejects.
  {
    const big = "x".repeat(201);
    const m = await postMembers(orgAAdmin.token, { email: `t8_${stamp}@organizationA.com`, displayName: big, targetRole: "member", organizationId: orgA.id });
    const mb = await j(m);
    const o = await postOrgs(owner.token, { organizationName: big, adminEmail: `t8o_${stamp}@x.com`, adminDisplayName: "T8" });
    const obd = await j(o);
    const missing = await postMembers(orgAAdmin.token, { email: "", displayName: "", targetRole: "", organizationId: "" });
    const mmb = await j(missing);
    ok("8a. Oversized displayName -> 400 invalidName", m.status === 400 && mb?.error === "invalidName", `status=${m.status} error=${mb?.error}`);
    ok("8b. Oversized org name -> 400 invalidOrgName", o.status === 400 && obd?.error === "invalidOrgName", `status=${o.status} error=${obd?.error}`);
    ok("8c. Empty/missing fields -> 400 invalidRequest", missing.status === 400 && mmb?.error === "invalidRequest", `status=${missing.status} error=${mmb?.error}`);

    // DB CHECK: a direct service-role insert of a 201-char org name is rejected (23514).
    const direct = await fetch(`${URL}/rest/v1/organizations`, {
      method: "POST",
      headers: { ...adminHeaders, Prefer: "return=representation" },
      body: JSON.stringify({ name: big }),
    });
    const db = await j(direct);
    const code = Array.isArray(db) ? null : db?.code;
    if (Array.isArray(db) && db[0]?.id) created.push({ type: "org", id: db[0].id }); // shouldn't happen; cleanup if it did
    ok("8d. DB CHECK rejects 201-char org name (23514)", direct.status >= 400 && code === "23514", `status=${direct.status} code=${code}`);
  }

  // 9) Method guard: non-POST -> 405.
  {
    const res = await fetch(`${BASE}/api/admin/members`, { method: "GET" });
    ok("9. Non-POST -> 405 (method guard)", res.status === 405, `status=${res.status}`);
  }

  // --- Cleanup -----------------------------------------------------------------
  for (const c of created) {
    if (c.type === "user") await deleteAuthUser(c.id);
  }
  for (const c of created) {
    if (c.type === "org") await deleteOrg(c.id);
  }
  const leftovers = [];
  for (const e of [`t5_${stamp}@organizationA.com`, `t7_${stamp}@neworg.com`]) {
    if ((await userByEmail(e)).length > 0) leftovers.push(e);
  }
  ok("Cleanup: created test users/orgs removed", leftovers.length === 0, leftovers.length ? `leftover: ${leftovers.join(", ")}` : "clean");

  return printReport();
}

function printReport() {
  console.log("\n==== ADMIN API VERIFICATION ====");
  let passed = 0;
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  [${r.detail}]` : ""}`);
    if (r.pass) passed++;
  }
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e.message);
  process.exit(2);
});
