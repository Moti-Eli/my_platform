/**
 * Local development seed script.
 *
 * Populates the linked Supabase project with fictional test data (2 orgs, each
 * with an admin + member role and a couple of users) so we can develop and demo
 * tenant isolation by logging in as different org admins.
 *
 * - Uses the SERVICE-ROLE (secret) key, which bypasses RLS — the legitimate,
 *   server-side-only use of that key. It is read from env, never hard-coded,
 *   and is NEVER used by the web app.
 * - Creates REAL Supabase auth users (via the admin API) plus their
 *   public.users profiles, so logins work and RLS (auth.uid()) behaves.
 * - Idempotent: clears previously-seeded test data (seed orgs by name + auth
 *   users whose email ends in ".test") before inserting, so it is safe to
 *   re-run without duplicate-key errors.
 *
 * Run with:  pnpm --filter @platform/db seed   (or: pnpm seed from the root)
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Env lives at the monorepo root .env. When run via pnpm the cwd is
// packages/db, so the root is two levels up.
const rootEnv = resolve(process.cwd(), "../../.env");
dotenv.config({ path: existsSync(rootEnv) ? rootEnv : undefined });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

/** Shared password for every seeded test user (dev only). */
const TEST_PASSWORD = "123456";
/** Permissions granted to the non-admin "Member" role. */
const MEMBER_PERMISSIONS = ["users.view", "users.invite"];

// Cleanup scoping: a user is considered "seed data" (and cleared on re-run) if
// its email matches a current seed domain OR a legacy suffix from an earlier
// seed version. Org names from earlier versions are cleared too.
const SEED_EMAIL_DOMAINS = ["@organizationa.com", "@organizationb.com"];
const LEGACY_EMAIL_SUFFIXES = [".test"];
const LEGACY_ORG_NAMES = ["Acme Corp", "Globex Inc"];

type SeedRole = "admin" | "member";

interface SeedUser {
  email: string;
  displayName: string;
  role: SeedRole;
}

interface SeedOrg {
  name: string;
  users: SeedUser[];
}

const SEED: SeedOrg[] = [
  {
    name: "Organization A",
    users: [
      { email: "admin1@organizationA.com", displayName: "Org A Admin 1", role: "admin" },
      { email: "admin2@organizationA.com", displayName: "Org A Admin 2", role: "admin" },
      { email: "user1@organizationA.com", displayName: "Org A User 1", role: "member" },
      { email: "user2@organizationA.com", displayName: "Org A User 2", role: "member" },
      { email: "user3@organizationA.com", displayName: "Org A User 3", role: "member" },
    ],
  },
  {
    name: "Organization B",
    users: [
      { email: "admin1@organizationB.com", displayName: "Org B Admin 1", role: "admin" },
      { email: "admin2@organizationB.com", displayName: "Org B Admin 2", role: "admin" },
      { email: "user1@organizationB.com", displayName: "Org B User 1", role: "member" },
      { email: "user2@organizationB.com", displayName: "Org B User 2", role: "member" },
      { email: "user3@organizationB.com", displayName: "Org B User 3", role: "member" },
    ],
  },
];

/** Whether an email belongs to seed data (current or legacy) and is safe to clear. */
function isSeedEmail(email: string | undefined): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  return (
    SEED_EMAIL_DOMAINS.some((domain) => e.endsWith(domain)) ||
    LEGACY_EMAIL_SUFFIXES.some((suffix) => e.endsWith(suffix))
  );
}

/** Throw on a Supabase error; otherwise return the data. */
function unwrap<T>(
  res: { data: T | null; error: { message: string } | null },
  context: string
): T {
  if (res.error) throw new Error(`${context}: ${res.error.message}`);
  if (res.data === null) throw new Error(`${context}: no data returned`);
  return res.data;
}

async function clearTestData(supabase: SupabaseClient): Promise<void> {
  // Delete seeded orgs by name (current + legacy) — cascades roles,
  // role_permissions, memberships, and membership_roles for those orgs.
  const orgNames = [...SEED.map((o) => o.name), ...LEGACY_ORG_NAMES];
  const delOrgs = await supabase.from("organizations").delete().in("name", orgNames);
  if (delOrgs.error) throw new Error(`clear orgs: ${delOrgs.error.message}`);

  // Delete seed auth users (current .com domains + legacy .test) — cascades
  // their public.users profiles (and any remaining memberships).
  const list = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (list.error) throw new Error(`list auth users: ${list.error.message}`);
  const testUsers = list.data.users.filter((u) => isSeedEmail(u.email));
  for (const user of testUsers) {
    const del = await supabase.auth.admin.deleteUser(user.id);
    if (del.error) throw new Error(`delete auth user ${user.email}: ${del.error.message}`);
  }
  console.log(`Cleared seed orgs and ${testUsers.length} existing seed auth user(s).`);
}

async function main(): Promise<void> {
  if (!SUPABASE_URL || !SECRET_KEY) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SECRET_KEY. Set them in the root .env."
    );
  }

  // Production guard: never seed a production database by accident.
  if (process.env.NODE_ENV === "production" && process.env.SEED_FORCE !== "1") {
    throw new Error("Refusing to run with NODE_ENV=production. Set SEED_FORCE=1 to override.");
  }

  const ref = SUPABASE_URL.replace(/^https?:\/\//, "").split(".")[0];
  console.log("");
  console.log("============================================================");
  console.log(" SEEDING TEST DATA (development only)");
  console.log(" Uses the SERVICE-ROLE secret key to bypass RLS for inserts.");
  console.log(` Target project URL : ${SUPABASE_URL}`);
  console.log(` Project ref        : ${ref}`);
  console.log("============================================================");
  console.log("");

  const supabase = createClient(SUPABASE_URL, SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  await clearTestData(supabase);

  // Map permission keys -> ids (the catalog is seeded by migrations).
  const perms = unwrap<{ id: string; key: string }[]>(
    await supabase.from("permissions").select("id,key"),
    "load permissions"
  );
  const permByKey = new Map(perms.map((p) => [p.key, p.id]));

  const credentials: Array<{
    email: string;
    password: string;
    organization: string;
    role: string;
  }> = [];

  for (const org of SEED) {
    const orgRow = unwrap<{ id: string }>(
      await supabase.from("organizations").insert({ name: org.name }).select("id").single(),
      `insert organization ${org.name}`
    );
    const orgId = orgRow.id;

    const adminRole = unwrap<{ id: string }>(
      await supabase
        .from("roles")
        .insert({ organization_id: orgId, name: "Admin", is_admin: true })
        .select("id")
        .single(),
      `insert Admin role for ${org.name}`
    );
    const memberRole = unwrap<{ id: string }>(
      await supabase
        .from("roles")
        .insert({ organization_id: orgId, name: "Member", is_admin: false })
        .select("id")
        .single(),
      `insert Member role for ${org.name}`
    );

    // Grant the Member role a couple of permissions.
    const rolePermRows = MEMBER_PERMISSIONS.map((key) => permByKey.get(key))
      .filter((id): id is string => Boolean(id))
      .map((permission_id) => ({ role_id: memberRole.id, permission_id }));
    if (rolePermRows.length > 0) {
      const rp = await supabase.from("role_permissions").insert(rolePermRows);
      if (rp.error) throw new Error(`insert role_permissions for ${org.name}: ${rp.error.message}`);
    }

    for (const user of org.users) {
      const created = await supabase.auth.admin.createUser({
        email: user.email,
        password: TEST_PASSWORD,
        email_confirm: true,
      });
      if (created.error) throw new Error(`create auth user ${user.email}: ${created.error.message}`);
      const authId = created.data.user?.id;
      if (!authId) throw new Error(`create auth user ${user.email}: no id returned`);
      // Supabase normalizes (lowercases) the email — keep the profile in sync.
      const normalizedEmail = created.data.user?.email ?? user.email.toLowerCase();

      const profile = await supabase
        .from("users")
        .insert({ id: authId, email: normalizedEmail, display_name: user.displayName });
      if (profile.error) throw new Error(`insert profile ${user.email}: ${profile.error.message}`);

      const membership = unwrap<{ id: string }>(
        await supabase
          .from("memberships")
          .insert({ user_id: authId, organization_id: orgId })
          .select("id")
          .single(),
        `insert membership ${user.email}`
      );

      const roleId = user.role === "admin" ? adminRole.id : memberRole.id;
      const mr = await supabase
        .from("membership_roles")
        .insert({ membership_id: membership.id, role_id: roleId, organization_id: orgId });
      if (mr.error) throw new Error(`assign role to ${user.email}: ${mr.error.message}`);

      credentials.push({
        email: user.email,
        password: TEST_PASSWORD,
        organization: org.name,
        role: user.role === "admin" ? "Admin" : "Member",
      });
    }

    console.log(`✓ Seeded "${org.name}" with ${org.users.length} users (Admin + Member roles).`);
  }

  console.log("");
  console.log(`Done. Seeded ${SEED.length} organizations: ${SEED.map((o) => o.name).join(", ")}.`);
  console.log("");
  console.log("LOGIN CREDENTIALS (development test users):");
  console.table(credentials);
  console.log(`All test users share the password: ${TEST_PASSWORD}`);
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("\nSEED FAILED:", message);
    process.exit(1);
  });
