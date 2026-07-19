/**
 * Staff — internal business logic (Standard §2 `logic.ts`). Reads the member list;
 * WRITES one thing — a member's role (Member↔Admin) on `membership_roles`.
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
 * WHY THIS LOGIC TAKES `getRls`, NOT THE `CortexDb`
 * -------------------------------------------------
 * `getOrganizationMembers` needs a real Supabase client (it does multi-table joins
 * that the deliberately tiny `CortexDb` surface doesn't express), and `CortexDb`
 * cannot hand one over: `@platform/cortex-core` is framework-agnostic and must not
 * depend on `@supabase/*` (see the header of `packages/cortex-core/src/db.ts`). So
 * rather than leak a SupabaseClient type into the core, this factory takes the SAME
 * per-user RLS-client factory the data-layer already builds (`getRls` in
 * `server-runtime.ts`). It is the RLS client, NEVER the service client — this is a
 * per-user, RLS-scoped read, and service_role would bypass the very policy that
 * makes the answer correct.
 */
import type { SupabaseClient } from "@platform/db";
import { getOrganizationMembers } from "@platform/auth";
import type { Ctx } from "@platform/cortex-core";

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

export interface StaffLogic {
  listMembers(input: ListMembersInput, ctx: Ctx): Promise<Member[]>;
  setMemberRole(
    input: SetMemberRoleInput,
    ctx: Ctx,
  ): Promise<{ membershipId: string; isAdmin: boolean }>;
}

export function createStaffLogic({
  getRls,
}: {
  getRls: () => Promise<SupabaseClient>;
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
  };
}
