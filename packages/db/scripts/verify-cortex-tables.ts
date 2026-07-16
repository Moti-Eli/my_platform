/**
 * Verification harness for the Cortex tables reshaped onto the ORG TREE
 * (migration 20260716000002): `app_instances` + `inventory_items`.
 *
 * Builds a throwaway parent -> child org pair plus an unrelated org, seeds rows
 * at each level, and proves the SELECT policies:
 *   1. Member of the org reads its own rows                    -> visible
 *   2. Member of the PARENT reads a CHILD org's rows           -> visible (down)
 *   3. Member of the CHILD reads the PARENT's rows             -> NOT visible
 *   4. Non-member (unrelated org)                              -> NOT visible
 *   5. visibility='private'                                    -> NOT visible, even
 *      to a member of its own org who OWNS it (fail closed until record_grants)
 *   6. visibility='restricted'                                 -> NOT visible to anyone
 *   7. The same membership assertions for app_instances
 *   8. inventory_items insert without org_id                   -> rejected (NOT NULL)
 *
 * Cases 5/6 are asserting DELIBERATE fail-closed behavior, not a bug: the policy
 * admits only `visibility = 'org'` until the grant model lands. If they ever start
 * passing rows through, something has quietly widened access.
 *
 * Connection approach mirrors verify-org-tree.ts: setup/teardown through the
 * service-role client, and reads through a direct Postgres connection that
 * impersonates each user exactly as the API does (`set local role authenticated`
 * + `request.jwt.claims`, which is what auth.uid() reads), so the real RLS
 * policies — and the `grant select to authenticated` — are what get exercised.
 *
 * Env: the usual Supabase vars from the root `.env`, plus SUPABASE_DB_URL (the
 * Postgres connection string). Defaults to the local `supabase start` stack.
 *
 * Run:  pnpm --filter @platform/db exec tsx scripts/verify-cortex-tables.ts
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";

const rootEnv = resolve(process.cwd(), "../../.env");
dotenv.config({ path: existsSync(rootEnv) ? rootEnv : undefined });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;
const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!URL || !SECRET) throw new Error("Missing Supabase env in root .env");

const PREFIX = "CortexTables Test"; // tag so cleanup is targeted
const DEF_KEY = "verify-cortex-tables-def";
const EMAILS = {
  parent: "ct-parent@cortextables.test",
  child: "ct-child@cortextables.test",
  other: "ct-other@cortextables.test",
};

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { passed++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

async function cleanup(admin: SupabaseClient): Promise<void> {
  // parent_id is ON DELETE RESTRICT, so break the links before deleting. Rows in
  // app_instances / inventory_items cascade away with their org.
  await admin.from("organizations").update({ parent_id: null }).like("name", `${PREFIX}%`);
  await admin.from("organizations").delete().like("name", `${PREFIX}%`);
  await admin.from("app_definitions").delete().eq("key", DEF_KEY);
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

async function makeMember(admin: SupabaseClient, orgId: string, email: string): Promise<string> {
  const created = await admin.auth.admin.createUser({ email, password: "123456", email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`create ${email}: ${created.error?.message}`);
  const userId = created.data.user.id;
  const prof = await admin
    .from("users")
    .insert({ id: userId, email: created.data.user.email ?? email, display_name: email });
  if (prof.error) throw new Error(`profile ${email}: ${prof.error.message}`);
  const mem = await admin.from("memberships").insert({ user_id: userId, organization_id: orgId });
  if (mem.error) throw new Error(`membership ${email}: ${mem.error.message}`);
  return userId;
}

async function makeItem(
  admin: SupabaseClient,
  orgId: string,
  ownerId: string,
  name: string,
  visibility: "private" | "org" | "restricted"
): Promise<string> {
  const res = await admin
    .from("inventory_items")
    .insert({ org_id: orgId, owner_id: ownerId, name: `${PREFIX} ${name}`, visibility })
    .select("id")
    .single();
  if (res.error || !res.data) throw new Error(`create item ${name}: ${res.error?.message}`);
  return (res.data as { id: string }).id;
}

async function makeInstance(
  admin: SupabaseClient,
  definitionId: string,
  orgId: string,
  ownerId: string
): Promise<string> {
  const res = await admin
    .from("app_instances")
    .insert({ definition_id: definitionId, org_id: orgId, owner_id: ownerId })
    .select("id")
    .single();
  if (res.error || !res.data) throw new Error(`create instance: ${res.error?.message}`);
  return (res.data as { id: string }).id;
}

type Table = "inventory_items" | "app_instances";

/**
 * Can `userId` (or anon, when null) SELECT this row through RLS? Impersonates the
 * user the way a real API request does, inside a rolled-back transaction so the
 * `set local` cannot leak into the next call.
 */
async function canRead(pg: Client, userId: string | null, table: Table, rowId: string): Promise<boolean> {
  await pg.query("begin");
  try {
    await pg.query("set local role authenticated");
    await pg.query("select set_config('request.jwt.claims', $1, true)", [
      userId === null ? null : JSON.stringify({ sub: userId }),
    ]);
    // `table` is a closed union of literals from this file — never user input.
    const res = await pg.query(`select 1 from public.${table} where id = $1`, [rowId]);
    return (res.rowCount ?? 0) > 0;
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

    // Tree: Parent -> Child. Plus Other, an unrelated root.
    const parentOrg = await makeOrg(admin, "Parent", null);
    const childOrg = await makeOrg(admin, "Child", parentOrg);
    const otherOrg = await makeOrg(admin, "Other", null);

    const uParent = await makeMember(admin, parentOrg, EMAILS.parent);
    const uChild = await makeMember(admin, childOrg, EMAILS.child);
    const uOther = await makeMember(admin, otherOrg, EMAILS.other);

    const def = await admin
      .from("app_definitions")
      .insert({ key: DEF_KEY, name: "Verify Def", manifest: {} })
      .select("id")
      .single();
    if (def.error || !def.data) throw new Error(`create definition: ${def.error?.message}`);
    const defId = (def.data as { id: string }).id;

    const itemParent = await makeItem(admin, parentOrg, uParent, "parent-org item", "org");
    const itemChild = await makeItem(admin, childOrg, uChild, "child-org item", "org");
    const itemPrivate = await makeItem(admin, childOrg, uChild, "private item", "private");
    const itemRestricted = await makeItem(admin, childOrg, uChild, "restricted item", "restricted");

    const instParent = await makeInstance(admin, defId, parentOrg, uParent);
    const instChild = await makeInstance(admin, defId, childOrg, uChild);
    console.log(`\nSeeded "${PREFIX}": Parent -> Child (+ unrelated Other), items + instances.`);

    // --- [1] Member of the org reads its own rows -----------------------------
    console.log("\n[1] Member of the org reads its own inventory rows");
    check("child member -> child-org item is VISIBLE", await canRead(pg, uChild, "inventory_items", itemChild));
    check("parent member -> parent-org item is VISIBLE", await canRead(pg, uParent, "inventory_items", itemParent));

    // --- [2] Inheritance flows DOWN -------------------------------------------
    console.log("\n[2] Parent-org member reads the CHILD org's rows (inherits down)");
    check("parent member -> child-org item is VISIBLE", await canRead(pg, uParent, "inventory_items", itemChild));

    // --- [3] No upward leak ----------------------------------------------------
    console.log("\n[3] Child-org member must NOT read the PARENT's rows");
    check("child member -> parent-org item is NOT visible", !(await canRead(pg, uChild, "inventory_items", itemParent)));

    // --- [4] Non-member --------------------------------------------------------
    console.log("\n[4] Non-member (unrelated org) sees nothing");
    check("other member -> child-org item is NOT visible", !(await canRead(pg, uOther, "inventory_items", itemChild)));
    check("other member -> parent-org item is NOT visible", !(await canRead(pg, uOther, "inventory_items", itemParent)));
    check("anon -> child-org item is NOT visible", !(await canRead(pg, null, "inventory_items", itemChild)));

    // --- [5] visibility='private' — fail closed --------------------------------
    console.log("\n[5] visibility='private' is unreadable (fail closed until record_grants)");
    check(
      "child member -> its OWN private item is NOT visible (owner_id is not a grant)",
      !(await canRead(pg, uChild, "inventory_items", itemPrivate))
    );
    check("parent member -> private item is NOT visible", !(await canRead(pg, uParent, "inventory_items", itemPrivate)));

    // --- [6] visibility='restricted' — fail closed -----------------------------
    console.log("\n[6] visibility='restricted' is unreadable by anyone");
    check("child member -> restricted item is NOT visible", !(await canRead(pg, uChild, "inventory_items", itemRestricted)));
    check("parent member -> restricted item is NOT visible", !(await canRead(pg, uParent, "inventory_items", itemRestricted)));
    check("other member -> restricted item is NOT visible", !(await canRead(pg, uOther, "inventory_items", itemRestricted)));

    // --- [7] app_instances: same membership rules ------------------------------
    console.log("\n[7] app_instances follows the same org-tree membership rules");
    check("child member -> child-org instance is VISIBLE", await canRead(pg, uChild, "app_instances", instChild));
    check("parent member -> child-org instance is VISIBLE (down)", await canRead(pg, uParent, "app_instances", instChild));
    check("child member -> parent-org instance is NOT visible (no upward leak)", !(await canRead(pg, uChild, "app_instances", instParent)));
    check("other member -> child-org instance is NOT visible", !(await canRead(pg, uOther, "app_instances", instChild)));
    check("anon -> child-org instance is NOT visible", !(await canRead(pg, null, "app_instances", instChild)));

    // --- [8] org_id is mandatory -----------------------------------------------
    console.log("\n[8] inventory_items.org_id is NOT NULL");
    const noOrg = await admin
      .from("inventory_items")
      .insert({ owner_id: uChild, name: `${PREFIX} orphan`, visibility: "org" });
    check("insert without org_id is REJECTED", !!noOrg.error, noOrg.error?.message ?? "");

    await cleanup(admin);
    console.log("\n(cleaned up test orgs, users, definition, rows)\n");
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
