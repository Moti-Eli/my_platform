/**
 * Verification harness for `createOrganizationForCurrentUser` (@platform/auth).
 *
 * NOT part of the app — it exercises the REAL seam against the REAL local
 * Supabase project with REAL RLS, importing the SAME function the server calls.
 * The acting user is the seeded Org A admin (already a member of Organization A);
 * they call the function twice to spin up two brand-new ROOT organizations for
 * themselves. It proves:
 *
 *   1. Provisioning: both orgs created with error null; each parent_id is NULL
 *      (root, not child — asserted as NULL, not merely "not Org A"); the actor
 *      holds an is_admin role in each; each org has an Admin AND a Member role,
 *      and the Member role carries the NEW_ORG_MEMBER_PERMISSIONS baseline.
 *   2. The switcher sees them: reading `organizations` THROUGH RLS as the actor
 *      returns Org A AND both new orgs — proving no organizations RLS change was
 *      needed (its SELECT policy is auth_user_is_member_of(id), so the new
 *      membership alone makes each org visible). Positive control: a DIFFERENT
 *      seeded Org A member does NOT see either new org.
 *   3. Isolation: a note in Org A and a note in the first new org are BOTH visible
 *      to the actor (member of both), a plain Org A member sees ONLY the Org A
 *      note, and the Org B admin sees NEITHER.
 *   4. No tree inheritance in either direction (the important one). The new org is
 *      a ROOT — no parent — so it neither inherits from nor leaks into Org A. A
 *      'private' row owned by a plain Org A member is read by its owner and by an
 *      Org A tree admin (the admin private-read escape, present regardless of the
 *      new orgs), but NOT by a plain non-owner member, and NOT by someone who is
 *      now an admin of a brand-new ROOT org yet unrelated to Org A — creating a
 *      new root org grafts no one onto Org A's tree.
 *   5. The gate: calling with a signed-OUT client is rejected with EXACTLY
 *      "notAllowed", and NO organization row is created for that attempt.
 *   6. Validation: a whitespace-only organizationName is rejected with EXACTLY
 *      "invalidOrgName", and NO org row is created.
 *
 * TABLE CHOICE FOR [4]: `inventory_items`, NOT `notes`. `notes`' SELECT policy
 * admits only `visibility = 'org'` (private/restricted notes are readable by
 * nobody via RLS — no private read path). `inventory_items` is the table wired to
 * `private.auth_user_can_read`, where the org-tree admin private-read escape
 * (20260723000003) lives — the only table that can exercise "does an admin's tree
 * reach extend into a private row", which is exactly what [4] must probe.
 *
 * Run:  pnpm --filter @platform/db run verify:multi-org
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  createOrganizationForCurrentUser,
  hideOrganizationForCurrentUser,
  signUpWithNewOrganization,
} from "../../auth/src/index";

import { assertLocalDatabase } from "./db-guard";

// FIRST statement: refuse to run against a non-local database. This script WRITES.
// (db-guard loads the root .env itself, so this is safe before dotenv.config below.)
assertLocalDatabase("verify-multi-org.ts");

const rootEnv = resolve(process.cwd(), "../../.env");
dotenv.config({ path: existsSync(rootEnv) ? rootEnv : undefined });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET = process.env.SUPABASE_SECRET_KEY;
if (!URL || !ANON || !SECRET) throw new Error("Missing Supabase env in root .env");

const TEMP_PASSWORD = "123456";

// Seeded fixtures (from seed.ts) — NEVER created or deleted here.
const ACTING_ADMIN_EMAIL = "admin1@organizationA.com"; // Org A admin — the actor
const OTHER_A_ADMIN_EMAIL = "admin2@organizationA.com"; // Org A admin, uninvolved
const PLAIN_A_MEMBER_EMAIL = "user1@organizationA.com"; // plain Org A member (owner)
const PLAIN_A_MEMBER_2_EMAIL = "user2@organizationA.com"; // plain Org A member (non-owner)
const ORG_B_ADMIN_EMAIL = "admin1@organizationB.com"; // Org B admin (cross-tenant)

// Fixtures created by THIS harness (all names share a prefix for safe cleanup).
const NEW_ORG_1_NAME = "Multi-Org New Org 1 (verify)";
const NEW_ORG_2_NAME = "Multi-Org New Org 2 (verify)";
const NEW_ORG_FROM_B_NAME = "Multi-Org New Root From B (verify)";
const GATE_ORG_NAME = "Multi-Org Gate Attempt (verify)"; // scenario 5 — must NEVER exist
const INVALID_ORG_NAME_RAW = "   "; // scenario 6 — whitespace only
const ALL_CREATED_ORG_NAMES = [
  NEW_ORG_1_NAME,
  NEW_ORG_2_NAME,
  NEW_ORG_FROM_B_NAME,
  GATE_ORG_NAME,
  INVALID_ORG_NAME_RAW,
];

// Scenario 7 (per-user duplicate-name guard) builds a runtime-unique org name so
// a re-run never collides with leftovers. The exact name is unknown at module
// scope, so the sweep matches these by PREFIX instead of by exact name.
const DUP_ORG_PREFIX = "Multi-Org Dup";

// Scenario 8 (hideOrganizationForCurrentUser) also builds runtime-unique names,
// so the sweep matches its orgs by PREFIX too. This prefix covers ALL section-8
// orgs: the two throwaway orgs AND the last-org-guard user's signup org — and
// the prefix sweep deletes them by id via the SERVICE client, so a SOFT-DELETED
// org (deleted_at set) is removed exactly like an active one.
const HIDE_ORG_PREFIX = "Multi-Org Hide";
// The brand-new single-org user staged for the last-org guard (scenario 8.6) is
// the one EXTRA user this harness creates. Its email carries this prefix so the
// sweep can find and HARD-DELETE the auth user (cascading its profile/membership/
// role). Seeded users use @organizationA/B.com, so this prefix never matches one.
const HIDE_LASTORG_USER_PREFIX = "verify-multi-org-hide-lastorg-";
const HIDE_LASTORG_USER_DOMAIN = "verify-multi-org.test";

// Tool rows created here are tagged so cleanup finds them by name/title prefix —
// crucial for the rows that live in SEEDED Org A (those do NOT cascade, since Org
// A is never deleted, so they must be removed explicitly and FIRST).
const ROW_TAG = "verify-multi-org:";

// Mirrors @platform/auth's NEW_ORG_MEMBER_PERMISSIONS (empty — a plain member's
// baseline is membership itself; permissions are for actions beyond that). The
// Member role must carry EXACTLY these keys. seed.ts's MEMBER_PERMISSIONS is the
// same empty list.
const EXPECTED_MEMBER_PERMISSION_KEYS: string[] = [];

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

/** Sign in and return an authenticated client (RLS applies as that user). */
async function signInClient(email: string): Promise<{ client: SupabaseClient; userId: string }> {
  const client = createClient(URL!, ANON!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password: TEMP_PASSWORD });
  if (error || !data.user) throw new Error(`sign in ${email}: ${error?.message ?? "no user"}`);
  return { client, userId: data.user.id };
}

async function orgIdByName(admin: SupabaseClient, name: string): Promise<string> {
  const res = await admin.from("organizations").select("id").eq("name", name).single();
  if (res.error || !res.data) throw new Error(`org ${name}: ${res.error?.message}`);
  return (res.data as { id: string }).id;
}

/** Whether the user holds a role with the given is_admin flag in the org (service read). */
async function holdsRole(
  admin: SupabaseClient,
  userId: string,
  organizationId: string,
  wantAdmin: boolean
): Promise<boolean> {
  const mRes = await admin
    .from("memberships")
    .select("id")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (mRes.error || !mRes.data) return false;
  const mrRes = await admin
    .from("membership_roles")
    .select("role_id")
    .eq("membership_id", (mRes.data as { id: string }).id);
  if (mrRes.error) return false;
  const roleIds = ((mrRes.data ?? []) as Array<{ role_id: string }>).map((r) => r.role_id);
  if (roleIds.length === 0) return false;
  const rolesRes = await admin.from("roles").select("is_admin").in("id", roleIds);
  if (rolesRes.error) return false;
  return ((rolesRes.data ?? []) as Array<{ is_admin: boolean }>).some(
    (r) => Boolean(r.is_admin) === wantAdmin
  );
}

/** The org's roles as {name, is_admin} (service read). */
async function rolesOf(
  admin: SupabaseClient,
  organizationId: string
): Promise<Array<{ id: string; name: string; is_admin: boolean }>> {
  const res = await admin
    .from("roles")
    .select("id, name, is_admin")
    .eq("organization_id", organizationId);
  if (res.error) throw new Error(`roles of ${organizationId}: ${res.error.message}`);
  return (res.data ?? []) as Array<{ id: string; name: string; is_admin: boolean }>;
}

/** The permission KEYS carried by the org's non-admin Member role (service read). */
async function memberRolePermissionKeys(
  admin: SupabaseClient,
  organizationId: string
): Promise<string[]> {
  const roles = await rolesOf(admin, organizationId);
  const member = roles.find((r) => !r.is_admin && r.name === "Member") ?? roles.find((r) => !r.is_admin);
  if (!member) return [];
  const rpRes = await admin
    .from("role_permissions")
    .select("permission_id")
    .eq("role_id", member.id);
  if (rpRes.error) throw new Error(`role_permissions of ${organizationId}: ${rpRes.error.message}`);
  const permIds = ((rpRes.data ?? []) as Array<{ permission_id: string }>).map((r) => r.permission_id);
  if (permIds.length === 0) return [];
  const permsRes = await admin.from("permissions").select("key").in("id", permIds);
  if (permsRes.error) throw new Error(`permissions lookup: ${permsRes.error.message}`);
  return ((permsRes.data ?? []) as Array<{ key: string }>).map((p) => p.key).sort();
}

/** Delete this harness's tool rows FIRST, then its orgs — the safe order. */
async function sweep(admin: SupabaseClient): Promise<void> {
  // 1) Tool rows (notes + inventory_items) by tag. Rows in SEEDED Org A do NOT
  //    cascade (Org A is never deleted), so they MUST go before anything else.
  await admin.from("notes").delete().like("title", `${ROW_TAG}%`);
  await admin.from("inventory_items").delete().like("name", `${ROW_TAG}%`);
  // 2) Created orgs by name (org deletion cascades their roles/memberships and
  //    any tool rows still living inside a NEW org via org_id CASCADE).
  const orgs = await admin.from("organizations").select("id").in("name", ALL_CREATED_ORG_NAMES);
  for (const o of (orgs.data ?? []) as Array<{ id: string }>) {
    await admin.from("organizations").delete().eq("id", o.id);
  }
  // 2b) Scenario-7 dup-guard orgs share a runtime suffix, so match by PREFIX.
  //     This catches the base name created by BOTH users (two rows) plus any
  //     stray a failed assertion might leave. Uppercase/padded variants never
  //     persist (the guard rejects them), so a single prefix sweep suffices.
  const dupOrgs = await admin.from("organizations").select("id").like("name", `${DUP_ORG_PREFIX}%`);
  for (const o of (dupOrgs.data ?? []) as Array<{ id: string }>) {
    await admin.from("organizations").delete().eq("id", o.id);
  }
  // 2c) Scenario-8: FIRST hard-delete the EXTRA last-org-guard user(s) by email
  //     PREFIX. Deleting the auth user cascades its profile/membership/role (its
  //     signup org is emptied of members, then removed by the org sweep below).
  //     Runs on the SERVICE client, so it is never RLS-narrowed. This must
  //     precede the org sweep so the signup org is memberless when it is deleted.
  const staleUsers = await admin
    .from("users")
    .select("id")
    .like("email", `${HIDE_LASTORG_USER_PREFIX}%`);
  for (const u of (staleUsers.data ?? []) as Array<{ id: string }>) {
    await admin.auth.admin.deleteUser(u.id);
  }
  // 2d) Scenario-8 orgs (two throwaway orgs + the last-org-guard signup org)
  //     share a runtime suffix, so match by PREFIX. Deleting by id via the
  //     SERVICE client is NOT deleted_at-filtered, so the SOFT-DELETED org from
  //     the happy path is hard-deleted here exactly like the active ones. Org
  //     deletion cascades roles/memberships (including the extra seeded-user
  //     membership added in scenario 8.5).
  const hideOrgs = await admin.from("organizations").select("id").like("name", `${HIDE_ORG_PREFIX}%`);
  for (const o of (hideOrgs.data ?? []) as Array<{ id: string }>) {
    await admin.from("organizations").delete().eq("id", o.id);
  }
}

async function main(): Promise<void> {
  const admin = createClient(URL!, SECRET!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const orgA = await orgIdByName(admin, "Organization A");

  // --- Pre-clean: remove leftovers from a previous (possibly failed) run, in the
  //     same tool-rows-then-orgs order the final cleanup uses. Seeded data (users,
  //     Org A/B) is never touched.
  await sweep(admin);

  // --- Setup: the Org A admin creates two ROOT orgs for themselves ------------
  console.log("\n[setup] Org A admin creates two ROOT organizations");
  const { client: actorClient, userId: actorId } = await signInClient(ACTING_ADMIN_EMAIL);

  const res1 = await createOrganizationForCurrentUser(actorClient, admin, {
    organizationName: NEW_ORG_1_NAME,
  });
  check("new org 1 provisioned (error null)", res1.error === null, res1.error ?? "");
  const res2 = await createOrganizationForCurrentUser(actorClient, admin, {
    organizationName: NEW_ORG_2_NAME,
  });
  check("new org 2 provisioned (error null)", res2.error === null, res2.error ?? "");
  if (!res1.organizationId || !res2.organizationId) {
    console.log("\nRESULT: setup failed — cannot continue");
    process.exit(1);
  }
  const newOrg1 = res1.organizationId;
  const newOrg2 = res2.organizationId;

  // --- Scenario 1: provisioning is correct -----------------------------------
  console.log("\n[1] Provisioning is correct");
  const orgRows = await admin
    .from("organizations")
    .select("id, parent_id")
    .in("id", [newOrg1, newOrg2]);
  const parentById = new Map(
    ((orgRows.data ?? []) as Array<{ id: string; parent_id: string | null }>).map((o) => [
      o.id,
      o.parent_id,
    ])
  );
  check("new org 1 parent_id IS NULL (root, not child)", parentById.get(newOrg1) === null, `got ${JSON.stringify(parentById.get(newOrg1))}`);
  check("new org 2 parent_id IS NULL (root, not child)", parentById.get(newOrg2) === null, `got ${JSON.stringify(parentById.get(newOrg2))}`);

  check("actor holds is_admin role in new org 1", await holdsRole(admin, actorId, newOrg1, true));
  check("actor holds is_admin role in new org 2", await holdsRole(admin, actorId, newOrg2, true));

  for (const [orgId, tag] of [
    [newOrg1, "org 1"],
    [newOrg2, "org 2"],
  ] as Array<[string, string]>) {
    const roles = await rolesOf(admin, orgId);
    check(`${tag} has an Admin role (is_admin true)`, roles.some((r) => r.is_admin && r.name === "Admin"));
    check(`${tag} has a Member role (is_admin false)`, roles.some((r) => !r.is_admin && r.name === "Member"));
    const keys = await memberRolePermissionKeys(admin, orgId);
    check(
      `${tag} Member role carries the NEW_ORG_MEMBER_PERMISSIONS baseline`,
      JSON.stringify(keys) === JSON.stringify(EXPECTED_MEMBER_PERMISSION_KEYS),
      `keys=[${keys.join(",")}] expected=[${EXPECTED_MEMBER_PERMISSION_KEYS.join(",")}]`
    );
  }

  // --- Scenario 2: the switcher sees them (through RLS) ----------------------
  console.log("\n[2] The switcher sees them — reading organizations THROUGH RLS");
  const actorOrgs = await actorClient.from("organizations").select("id");
  const actorOrgIds = new Set(((actorOrgs.data ?? []) as Array<{ id: string }>).map((o) => o.id));
  check("actor sees Organization A", actorOrgIds.has(orgA));
  check("actor sees new org 1 (new membership alone → visible, no RLS change)", actorOrgIds.has(newOrg1));
  check("actor sees new org 2 (new membership alone → visible, no RLS change)", actorOrgIds.has(newOrg2));

  // Positive control: a DIFFERENT seeded Org A member does NOT see the new orgs.
  const { client: memberClient } = await signInClient(PLAIN_A_MEMBER_EMAIL);
  const memberOrgs = await memberClient.from("organizations").select("id");
  const memberOrgIds = new Set(((memberOrgs.data ?? []) as Array<{ id: string }>).map((o) => o.id));
  check("control: other Org A member still sees Organization A", memberOrgIds.has(orgA));
  check("other Org A member does NOT see new org 1", !memberOrgIds.has(newOrg1));
  check("other Org A member does NOT see new org 2", !memberOrgIds.has(newOrg2));

  // --- Scenario 3: isolation (notes) -----------------------------------------
  console.log("\n[3] Isolation — a note in Org A and a note in the new org");
  // Insert AS THE ACTOR through RLS (the notes INSERT policy pins
  // owner_id = auth.uid(), so the rows must be theirs). The actor is a member of
  // both Org A and new org 1, so can_write passes in both.
  const noteAIns = await actorClient
    .from("notes")
    .insert({ org_id: orgA, owner_id: actorId, title: `${ROW_TAG} org A note` })
    .select("id")
    .single();
  check("actor inserted a note in Org A", !noteAIns.error && !!noteAIns.data, noteAIns.error?.message ?? "");
  const noteNIns = await actorClient
    .from("notes")
    .insert({ org_id: newOrg1, owner_id: actorId, title: `${ROW_TAG} new org note` })
    .select("id")
    .single();
  check("actor inserted a note in new org 1", !noteNIns.error && !!noteNIns.data, noteNIns.error?.message ?? "");
  if (!noteAIns.data || !noteNIns.data) {
    console.log("\nRESULT: scenario 3 setup failed — cannot continue");
    await sweep(admin);
    process.exit(1);
  }
  const noteA = (noteAIns.data as { id: string }).id;
  const noteN = (noteNIns.data as { id: string }).id;

  const actorNotes = await actorClient.from("notes").select("id").in("id", [noteA, noteN]);
  const actorNoteIds = new Set(((actorNotes.data ?? []) as Array<{ id: string }>).map((n) => n.id));
  check("actor reads the Org A note (member of both)", actorNoteIds.has(noteA));
  check("actor reads the new-org note (member of both)", actorNoteIds.has(noteN));

  const memberNotes = await memberClient.from("notes").select("id").in("id", [noteA, noteN]);
  const memberNoteIds = new Set(((memberNotes.data ?? []) as Array<{ id: string }>).map((n) => n.id));
  check("plain Org A member reads the Org A note", memberNoteIds.has(noteA));
  check("plain Org A member does NOT read the new-org note", !memberNoteIds.has(noteN));

  const { client: adminBClient } = await signInClient(ORG_B_ADMIN_EMAIL);
  const bNotes = await adminBClient.from("notes").select("id").in("id", [noteA, noteN]);
  const bNoteIds = new Set(((bNotes.data ?? []) as Array<{ id: string }>).map((n) => n.id));
  check("Org B admin reads NEITHER note", !bNoteIds.has(noteA) && !bNoteIds.has(noteN));

  // --- Scenario 4: no tree inheritance in either direction (inventory_items) --
  console.log("\n[4] No tree inheritance either direction — a 'private' Org A row");
  // A 'private' inventory_items row in SEEDED Org A, owned by a plain Org A
  // member. Inserted via the service client (owner_id set explicitly), mirroring
  // verify-can-read.ts — 'private' rows are never RLS-insertable by a plain
  // member, and "owned by" is satisfied by owner_id.
  const { userId: plainMemberId } = await signInClient(PLAIN_A_MEMBER_EMAIL);
  const privIns = await admin
    .from("inventory_items")
    .insert({ org_id: orgA, owner_id: plainMemberId, name: `${ROW_TAG} private A item`, visibility: "private" })
    .select("id")
    .single();
  check("seeded a private Org A item owned by a plain member", !privIns.error && !!privIns.data, privIns.error?.message ?? "");
  if (!privIns.data) {
    console.log("\nRESULT: scenario 4 setup failed — cannot continue");
    await sweep(admin);
    process.exit(1);
  }
  const privItem = (privIns.data as { id: string }).id;

  const canRead = async (client: SupabaseClient): Promise<boolean> => {
    const r = await client.from("inventory_items").select("id").eq("id", privItem);
    return (r.data ?? []).length === 1;
  };

  // Positive controls — the read path works and is present in Org A regardless of
  // the new orgs: the owner reads it, and an Org A tree admin reads it (the
  // admin private-read escape, 20260723000003).
  check("owner (plain Org A member) reads their private item", await canRead(memberClient));
  const { client: otherAAdminClient } = await signInClient(OTHER_A_ADMIN_EMAIL);
  check("Org A admin reads it via the tree admin escape", await canRead(otherAAdminClient));

  // Negatives — the new orgs changed nothing about who reads it:
  const { client: member2Client } = await signInClient(PLAIN_A_MEMBER_2_EMAIL);
  check("a plain NON-owner Org A member does NOT read the private item", !(await canRead(member2Client)));

  // The crux: the Org B admin creates a brand-new ROOT org (so they ARE now an
  // admin of a new root org) — and STILL reads nothing in Org A. Being an admin
  // of a new root org grafts no one onto Org A's tree, in either direction.
  const resFromB = await createOrganizationForCurrentUser(adminBClient, admin, {
    organizationName: NEW_ORG_FROM_B_NAME,
  });
  check("Org B admin provisions their own ROOT org (error null)", resFromB.error === null, resFromB.error ?? "");
  check(
    "an admin of a NEW ROOT org (unrelated to Org A) does NOT read Org A's private item",
    !(await canRead(adminBClient)),
    "new root org grants nothing in Org A — no cross-root inheritance"
  );

  // --- Scenario 5: the gate (signed-out → EXACTLY "notAllowed", no org row) ---
  console.log("\n[5] The gate — a signed-OUT client is rejected");
  const signedOut = createClient(URL!, ANON!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const gateRes = await createOrganizationForCurrentUser(signedOut, admin, {
    organizationName: GATE_ORG_NAME,
  });
  check(
    "signed-out call rejected with EXACTLY 'notAllowed'",
    gateRes.error === "notAllowed",
    `returned error=${JSON.stringify(gateRes.error)} organizationId=${JSON.stringify(gateRes.organizationId)}`
  );
  const gateOrg = await admin.from("organizations").select("id").eq("name", GATE_ORG_NAME);
  check("no organization row was created for the signed-out attempt", (gateOrg.data ?? []).length === 0);

  // --- Scenario 6: validation (whitespace name → EXACTLY "invalidOrgName") ----
  console.log("\n[6] Validation — a whitespace-only name is rejected");
  const invalidRes = await createOrganizationForCurrentUser(actorClient, admin, {
    organizationName: INVALID_ORG_NAME_RAW,
  });
  check(
    "whitespace-only name rejected with EXACTLY 'invalidOrgName'",
    invalidRes.error === "invalidOrgName",
    `returned error=${JSON.stringify(invalidRes.error)} organizationId=${JSON.stringify(invalidRes.organizationId)}`
  );
  const invalidOrg = await admin
    .from("organizations")
    .select("id")
    .eq("name", INVALID_ORG_NAME_RAW);
  check("no organization row was created for the invalid-name attempt", (invalidOrg.data ?? []).length === 0);

  // --- Scenario 7: per-user duplicate-name guard (nameExists) ----------------
  console.log("\n[7] Per-user duplicate-name guard — EXACTLY 'nameExists'");
  // Unique suffix so a re-run never collides with leftovers; the sweep matches
  // this by DUP_ORG_PREFIX, so every variant below is cleaned up regardless.
  const dupName = `${DUP_ORG_PREFIX} ${Date.now()} (verify)`;

  // 7.1 First creation by the actor succeeds.
  const dup1 = await createOrganizationForCurrentUser(actorClient, admin, {
    organizationName: dupName,
  });
  check(
    "actor creates the dup-test org (error null)",
    dup1.error === null,
    `returned error=${JSON.stringify(dup1.error)}`
  );

  // 7.2 Identical name → EXACTLY 'nameExists', and NO second row is created.
  const dup2 = await createOrganizationForCurrentUser(actorClient, admin, {
    organizationName: dupName,
  });
  check(
    "identical name rejected with EXACTLY 'nameExists'",
    dup2.error === "nameExists",
    `returned error=${JSON.stringify(dup2.error)} organizationId=${JSON.stringify(dup2.organizationId)}`
  );
  const afterDup2 = await admin.from("organizations").select("id").eq("name", dupName);
  check(
    "still exactly ONE org with that name after the identical retry (no 2nd row)",
    (afterDup2.data ?? []).length === 1,
    `count=${(afterDup2.data ?? []).length}`
  );

  // 7.3 Case + whitespace: UPPERCASED and space-padded are BOTH rejected —
  //     proves the guard trims and compares case-insensitively. Still one row.
  const dupUpper = await createOrganizationForCurrentUser(actorClient, admin, {
    organizationName: dupName.toUpperCase(),
  });
  check(
    "UPPERCASED name rejected with EXACTLY 'nameExists' (case-insensitive)",
    dupUpper.error === "nameExists",
    `returned error=${JSON.stringify(dupUpper.error)} organizationId=${JSON.stringify(dupUpper.organizationId)}`
  );
  const dupPadded = await createOrganizationForCurrentUser(actorClient, admin, {
    organizationName: `   ${dupName}   `,
  });
  check(
    "space-padded name rejected with EXACTLY 'nameExists' (trimmed)",
    dupPadded.error === "nameExists",
    `returned error=${JSON.stringify(dupPadded.error)} organizationId=${JSON.stringify(dupPadded.organizationId)}`
  );
  const afterVariants = await admin.from("organizations").select("id").eq("name", dupName);
  check(
    "still exactly ONE org with that name after case/whitespace retries",
    (afterVariants.data ?? []).length === 1,
    `count=${(afterVariants.data ?? []).length}`
  );

  // 7.4 Positive control — the guard is PER-USER, not global: a DIFFERENT seeded
  //     user (the Org B admin) creates an org with the SAME name, error null.
  //     Proves the guard did NOT become a global unique constraint.
  const dupFromB = await createOrganizationForCurrentUser(adminBClient, admin, {
    organizationName: dupName,
  });
  check(
    "control: a DIFFERENT user creates the SAME name successfully (per-user, not global)",
    dupFromB.error === null,
    `returned error=${JSON.stringify(dupFromB.error)}`
  );
  const afterFromB = await admin.from("organizations").select("id").eq("name", dupName);
  check(
    "now exactly TWO orgs share that name (one per user) — guard is per-user, not a global UNIQUE",
    (afterFromB.data ?? []).length === 2,
    `count=${(afterFromB.data ?? []).length}`
  );

  // --- Scenario 8: hideOrganizationForCurrentUser (soft-delete an org) -------
  console.log("\n[8] hideOrganizationForCurrentUser — soft-delete, RLS filter, guards");

  // Read an org's deleted_at via the SERVICE client (bypasses RLS, so a
  // soft-deleted row is STILL visible — the whole point of a read-back). Returns
  // the literal "missing" only when the row is truly gone (never expected here).
  const deletedAtOf = async (orgId: string): Promise<string | null | "missing"> => {
    const r = await admin
      .from("organizations")
      .select("deleted_at")
      .eq("id", orgId)
      .maybeSingle();
    if (r.error || !r.data) return "missing";
    return (r.data as { deleted_at: string | null }).deleted_at;
  };

  // 8.0 Setup: the actor creates TWO throwaway ROOT orgs (unique-suffixed) so
  //     they have several ACTIVE orgs to work with alongside Org A — hiding one
  //     here can never trip the last-org guard (the actor is also still a member
  //     of Org A and the earlier new orgs).
  const hideSuffix = `${Date.now()} (verify)`;
  const hideOrg1Name = `${HIDE_ORG_PREFIX} 1 ${hideSuffix}`;
  const hideOrg2Name = `${HIDE_ORG_PREFIX} 2 ${hideSuffix}`;
  const hideRes1 = await createOrganizationForCurrentUser(actorClient, admin, {
    organizationName: hideOrg1Name,
  });
  const hideRes2 = await createOrganizationForCurrentUser(actorClient, admin, {
    organizationName: hideOrg2Name,
  });
  check(
    "8.0 setup: actor creates two throwaway orgs (both error null)",
    hideRes1.error === null && hideRes2.error === null,
    `err1=${JSON.stringify(hideRes1.error)} err2=${JSON.stringify(hideRes2.error)}`
  );
  if (!hideRes1.organizationId || !hideRes2.organizationId) {
    console.log("\nRESULT: scenario 8 setup failed — cannot continue");
    await sweep(admin);
    process.exit(1);
  }
  const hideOrg1 = hideRes1.organizationId; // hidden in the happy path
  const hideOrg2 = hideRes2.organizationId; // kept ACTIVE for the negative controls

  // 8.1 Happy path: the actor hides one of their own throwaway orgs → error null.
  const happy = await hideOrganizationForCurrentUser(actorClient, admin, {
    organizationId: hideOrg1,
  });
  check(
    "8.1 actor hides their own throwaway org (error null)",
    happy.error === null,
    `returned error=${JSON.stringify(happy.error)}`
  );

  // 8.2 Reading `organizations` THROUGH the ACTOR's RLS client, the hidden org
  //     NO LONGER appears (proves the SELECT policy's deleted_at IS NULL filter).
  //     Positive control: the OTHER throwaway org and Org A still DO appear.
  const afterHideOrgs = await actorClient.from("organizations").select("id");
  const afterHideIds = new Set(
    ((afterHideOrgs.data ?? []) as Array<{ id: string }>).map((o) => o.id)
  );
  check(
    "8.2 hidden org NO LONGER visible through the actor's RLS (deleted_at filter)",
    !afterHideIds.has(hideOrg1)
  );
  check("8.2 control: the OTHER throwaway org STILL visible", afterHideIds.has(hideOrg2));
  check("8.2 control: Organization A STILL visible", afterHideIds.has(orgA));

  // 8.3 Service-client read-back: the hidden org's row STILL EXISTS with
  //     deleted_at NOT NULL — proof it was SOFT-deleted, not hard-deleted (the
  //     data survived).
  const hiddenDeletedAt = await deletedAtOf(hideOrg1);
  check(
    "8.3 hidden org row STILL EXISTS with deleted_at NOT NULL (soft, not hard)",
    hiddenDeletedAt !== "missing" && hiddenDeletedAt !== null,
    `deleted_at=${JSON.stringify(hiddenDeletedAt)}`
  );

  // 8.4 Non-member rejected: a DIFFERENT user (the Org B admin, NOT a member of
  //     hideOrg2) attempts to hide it → EXACTLY "notAllowed"; service read-back
  //     confirms its deleted_at is still NULL (nothing happened).
  const nonMember = await hideOrganizationForCurrentUser(adminBClient, admin, {
    organizationId: hideOrg2,
  });
  check(
    "8.4 non-member (Org B admin) rejected with EXACTLY 'notAllowed'",
    nonMember.error === "notAllowed",
    `returned error=${JSON.stringify(nonMember.error)}`
  );
  const afterNonMember = await deletedAtOf(hideOrg2);
  check(
    "8.4 read-back: rejected org's deleted_at STILL NULL (nothing happened)",
    afterNonMember === null,
    `deleted_at=${JSON.stringify(afterNonMember)}`
  );

  // 8.5 Solo-only guard: add a SECOND active member to hideOrg2 by directly
  //     inserting a membership for another SEEDED user via the service client —
  //     mirroring seed.ts's bare `memberships` insert (user_id + organization_id).
  //     The solo guard counts MEMBERSHIPS only, so no membership_role is needed
  //     (and a service-client role insert would hit the escalation trigger, which
  //     reads auth.uid()=null — so we deliberately do NOT add one). The actor then
  //     attempts to hide hideOrg2 → EXACTLY "orgHasOtherMembers"; read-back
  //     confirms deleted_at still NULL.
  const { userId: secondMemberId } = await signInClient(PLAIN_A_MEMBER_2_EMAIL);
  const addMembership = await admin
    .from("memberships")
    .insert({ user_id: secondMemberId, organization_id: hideOrg2 });
  check(
    "8.5 setup: a second seeded member added to the throwaway org (via service client)",
    !addMembership.error,
    addMembership.error?.message ?? ""
  );
  const shared = await hideOrganizationForCurrentUser(actorClient, admin, {
    organizationId: hideOrg2,
  });
  check(
    "8.5 hiding an org with other active members rejected with EXACTLY 'orgHasOtherMembers'",
    shared.error === "orgHasOtherMembers",
    `returned error=${JSON.stringify(shared.error)}`
  );
  const afterShared = await deletedAtOf(hideOrg2);
  check(
    "8.5 read-back: shared org's deleted_at STILL NULL (nothing happened)",
    afterShared === null,
    `deleted_at=${JSON.stringify(afterShared)}`
  );

  // 8.6 Last-org guard. HOW IT IS STAGED WITHOUT TOUCHING SEEDED DATA: create a
  //     BRAND-NEW user via signUpWithNewOrganization, which gives them EXACTLY
  //     ONE org (their own signup org). THEY then attempt to hide their only org
  //     → EXACTLY "cannotHideLastOrg"; read-back confirms deleted_at NULL. No
  //     seeded user's org is ever hidden — this new user and their org are the
  //     only things staged, and the sweep removes both (by email/name prefix).
  const lastOrgUserEmail = `${HIDE_LASTORG_USER_PREFIX}${Date.now()}@${HIDE_LASTORG_USER_DOMAIN}`;
  const lastOrgName = `${HIDE_ORG_PREFIX} LastOrg ${hideSuffix}`;
  const signUp = await signUpWithNewOrganization(admin, {
    email: lastOrgUserEmail,
    password: TEMP_PASSWORD,
    displayName: "Verify Last-Org User",
    organizationName: lastOrgName,
  });
  check(
    "8.6 setup: a brand-new single-org user is provisioned (error null)",
    signUp.error === null && !!signUp.organizationId && !!signUp.userId,
    `returned error=${JSON.stringify(signUp.error)}`
  );
  if (signUp.organizationId && signUp.userId) {
    const { client: lastOrgClient } = await signInClient(lastOrgUserEmail);
    const lastOrg = await hideOrganizationForCurrentUser(lastOrgClient, admin, {
      organizationId: signUp.organizationId,
    });
    check(
      "8.6 hiding one's ONLY org rejected with EXACTLY 'cannotHideLastOrg'",
      lastOrg.error === "cannotHideLastOrg",
      `returned error=${JSON.stringify(lastOrg.error)}`
    );
    const afterLastOrg = await deletedAtOf(signUp.organizationId);
    check(
      "8.6 read-back: only-org's deleted_at STILL NULL (nothing happened)",
      afterLastOrg === null,
      `deleted_at=${JSON.stringify(afterLastOrg)}`
    );
  }

  // --- Cleanup (ORDER MATTERS) ----------------------------------------------
  // Tool rows FIRST (notes/inventory_items — the ones in seeded Org A do NOT
  // cascade, and tool tables reference users NO ACTION), THEN the created orgs
  // (which cascade their roles/memberships and any tool rows still inside a new
  // org). Seeded users and Org A/B are left intact.
  await sweep(admin);
  console.log("\n(cleaned up: tool rows → created orgs; seeded data untouched)\n");

  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error("VERIFY FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
