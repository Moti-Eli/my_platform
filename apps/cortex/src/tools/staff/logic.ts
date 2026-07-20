/**
 * Staff — internal business logic (Standard §2 `logic.ts`). Reads the member list;
 * WRITES two things — a member's role (Member↔Admin) on `membership_roles`, and a
 * NEW member added to the org (a fresh auth user joined as a plain member).
 *
 * Unlike inventory/tasks, staff has NO table of its own: it reads the EXISTING
 * platform tables (memberships / roles / users) through `@platform/auth`'s
 * `getOrganizationMembers`, which runs as the current user so RLS returns only the
 * caller's org and only co-members' profiles. The role write is a single ATOMIC RPC
 * — `public.set_member_role` (20260717000008) — which does the add-role + remove-role
 * in one transaction (a rejected demote rolls the add back too, so no orphan role
 * row), resolving the org's Admin/Member roles server-side. Its `membership_roles`
 * triggers (no_escalation, keep_org_admin) enforce "only an admin may change roles"
 * and "the org's last admin can't be demoted" — this code does NOT re-check either;
 * it calls the RPC and lets the DB raise, then the data-layer maps it to a stable code.
 *
 * The add-member write goes through `@platform/auth`'s `addMemberToOrg`, which takes
 * BOTH clients: the per-user RLS client (`getRls` — runs the `members.manage` gate and
 * the role-assignment write, which the DB re-decides against the real actor) and the
 * `service` client (creates the auth user + profile + membership, which have no INSERT
 * policy for `authenticated`). The org is ALWAYS `ctx.orgId`, never from the caller.
 *
 * WHY THIS LOGIC TAKES `getRls` (+ `service`), NOT THE `CortexDb`
 * --------------------------------------------------------------
 * `getOrganizationMembers`/`addMemberToOrg` need a real Supabase client (multi-table
 * joins and admin writes the deliberately tiny `CortexDb` surface doesn't express),
 * and `CortexDb` cannot hand one over: `@platform/cortex-core` is framework-agnostic
 * and must not depend on `@supabase/*` (see the header of `packages/cortex-core/src/db.ts`).
 * So rather than leak a SupabaseClient type into the core, this factory takes the SAME
 * per-user RLS-client factory the data-layer already builds (`getRls` in
 * `server-runtime.ts`) plus the `service` client. `getRls` is the RLS client for the
 * read and the gated role write; `service` is used ONLY for the privileged user/
 * profile/membership inserts inside `addMemberToOrg`.
 */
import type { SupabaseClient } from "@platform/db";
import { getOrganizationMembers, addMemberToOrg } from "@platform/auth";
import type { Ctx } from "@platform/cortex-core";

/**
 * The temp password for a newly-added member — same policy as the web add-member
 * flow: a known dev password so the demo can log in at once, and a random,
 * never-disclosed one in production.
 *
 * NB: the web blueprint (a `server-only` module) uses node:crypto's `randomBytes`.
 * THIS module is client-bundled (runtime.ts registers staff on the client to LIST
 * it), so a node:crypto import would break the client build. We use the Web Crypto
 * global instead — available identically in Node 18+ and the browser — to mint the
 * same 24-byte base64url secret. This path only ever RUNS server-side (add_member is
 * server-only); the global just keeps the bundle clean.
 */
const DEV_TEMP_PASSWORD = "123456";
function newUserPassword(): string {
  if (process.env.NODE_ENV !== "production") return DEV_TEMP_PASSWORD;
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  // base64url: base64 with +/ → -_ and no padding.
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** One org member as returned to the AI/views. `OrgMember.roles` is flattened to a
 * single `isAdmin` boolean — the staff list only needs the badge, not the roles. */
export interface Member {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string | null;
  isAdmin: boolean;
  joinedAt: string;
}

/** list_members takes no input — the org comes from ctx, not the caller. */
export interface ListMembersInput {}

/** Switch one member between Member and Admin in the caller's active org. */
export interface SetMemberRoleInput {
  membershipId: string;
  targetRole: "admin" | "member";
}

/** Add a NEW user to the caller's active org as a plain member. Org is ctx, not input. */
export interface AddMemberInput {
  email: string;
  displayName: string;
}

export interface StaffLogic {
  listMembers(input: ListMembersInput, ctx: Ctx): Promise<Member[]>;
  setMemberRole(
    input: SetMemberRoleInput,
    ctx: Ctx,
  ): Promise<{ membershipId: string; isAdmin: boolean }>;
  addMember(input: AddMemberInput, ctx: Ctx): Promise<{ userId: string }>;
}

export function createStaffLogic({
  getRls,
  service,
}: {
  getRls: () => Promise<SupabaseClient>;
  service: SupabaseClient;
}): StaffLogic {
  return {
    async listMembers(_input, ctx) {
      // Through the SAME per-user RLS client the data-layer uses — never service.
      // getOrganizationMembers runs as the caller, so RLS guarantees it only
      // returns members of orgs the caller belongs to, and only co-members'
      // profiles (never the global users table).
      const supabase = await getRls();
      const members = await getOrganizationMembers(supabase, ctx.orgId);
      return members.map((m) => ({
        membershipId: m.membershipId,
        userId: m.userId,
        email: m.email,
        displayName: m.displayName,
        // Flatten the per-membership roles into one boolean: an admin holds ANY
        // is_admin role.
        isAdmin: m.roles.some((r) => r.isAdmin),
        joinedAt: m.joinedAt,
      }));
    },

    async setMemberRole(input, _ctx) {
      // ONE atomic RPC through the SAME per-user RLS client as the read — NEVER
      // service. `public.set_member_role` resolves the org's Admin/Member roles and
      // does the add+remove in a single transaction, so a rejected demote leaves no
      // orphan role row. It runs SECURITY DEFINER, but the membership_roles triggers
      // still fire and still read auth.uid() (the caller), so a non-admin is still
      // refused and the last admin still can't be demoted — we do NOT re-check here;
      // we call and surface the DB's error (the data-layer maps it to a stable code).
      const { membershipId, targetRole } = input;
      const rls = await getRls();
      const { error } = await rls.rpc("set_member_role", {
        p_membership_id: membershipId,
        p_target_role: targetRole, // "admin" | "member"
      });
      if (error) throw new Error(error.message);
      return { membershipId, isAdmin: targetRole === "admin" };
    },

    async addMember(input, ctx) {
      // BOTH clients: the per-user RLS client (the actor — runs the members.manage
      // gate and the role-assignment write the DB re-decides per-row) and the
      // service client (creates the auth user/profile/membership). The org is
      // ALWAYS ctx.orgId — never the caller's claim. On any seam error we throw its
      // stable key so the action maps it (emailExists/notAllowed/... → IntentResult).
      const password = newUserPassword();
      const rls = await getRls();
      // The form labels the name optional, but the seam rejects an empty name with
      // "invalidName". Fall back to the email local-part (as signup/ProfileView do)
      // when the caller left it blank; harmless on the existing-identity link path,
      // which never writes a profile.
      const email = input.email.trim();
      const displayName = input.displayName.trim() || (email.split("@")[0] ?? "");
      const result = await addMemberToOrg(rls, service, {
        email,
        displayName,
        organizationId: ctx.orgId,
        password,
      });
      if (result.error) throw new Error(result.error);
      return { userId: result.userId! };
    },
  };
}
