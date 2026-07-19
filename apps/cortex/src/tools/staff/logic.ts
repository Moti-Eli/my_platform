/**
 * Staff — internal business logic (Standard §2 `logic.ts`). Reads the member list;
 * WRITES one thing — a member's role (Member↔Admin) on `membership_roles`.
 *
 * Unlike inventory/tasks, staff has NO table of its own: it reads the EXISTING
 * platform tables (memberships / roles / users) through `@platform/auth`'s
 * `getOrganizationMembers`, which runs as the current user so RLS returns only the
 * caller's org and only co-members' profiles. The role write goes to the same
 * platform table `membership_roles`, whose triggers (no_escalation, keep_org_admin)
 * enforce "only an admin may change roles" and "the org's last admin can't be
 * demoted" — this code does NOT re-check either; it attempts the write and lets the
 * DB raise, then the data-layer maps the error to a stable code.
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

    async setMemberRole(input, ctx) {
      // Same per-user RLS client as the read — NEVER service. The membership_roles
      // triggers (no_escalation before-row; keep_org_admin after-row) are what
      // actually authorize this: a non-admin's write is refused, and demoting the
      // last admin is refused. We do NOT pre-check either (that would duplicate the
      // triggers and drift from them); we attempt and let the DB be the authority.
      const supabase = await getRls();

      // (a) Resolve this org's Admin and Member roles. adminRole is the is_admin
      //     role; memberRole is the non-admin role, preferring the one named
      //     "Member" (mirrors the web dashboard's role resolution).
      const rolesRes = await supabase
        .from("roles")
        .select("id, name, is_admin")
        .eq("organization_id", ctx.orgId);
      if (rolesRes.error) {
        throw new Error(`staff.setMemberRole (roles): ${rolesRes.error.message}`);
      }
      const roles = (rolesRes.data ?? []) as Array<{
        id: string;
        name: string;
        is_admin: boolean;
      }>;
      const adminRole = roles.find((r) => r.is_admin);
      const memberRole =
        roles.find((r) => !r.is_admin && r.name === "Member") ?? roles.find((r) => !r.is_admin);
      if (!adminRole || !memberRole) {
        throw new Error("staff.setMemberRole: org is missing an Admin or Member role");
      }

      // (b) Which role to add, which to remove.
      const addRoleId = input.targetRole === "admin" ? adminRole.id : memberRole.id;
      const removeRoleId = input.targetRole === "admin" ? memberRole.id : adminRole.id;

      // (c) Add the target role first (upsert, ignoring an existing duplicate so a
      //     re-apply is a no-op), THEN remove the other. The keep_org_admin trigger
      //     surfaces here: demoting the last admin makes the DELETE below raise.
      const upsertRes = await supabase
        .from("membership_roles")
        .upsert(
          { membership_id: input.membershipId, role_id: addRoleId, organization_id: ctx.orgId },
          { onConflict: "membership_id,role_id", ignoreDuplicates: true },
        );
      if (upsertRes.error) {
        throw new Error(`staff.setMemberRole (add): ${upsertRes.error.message}`);
      }

      const deleteRes = await supabase
        .from("membership_roles")
        .delete()
        .eq("membership_id", input.membershipId)
        .eq("role_id", removeRoleId);
      if (deleteRes.error) {
        throw new Error(`staff.setMemberRole (remove): ${deleteRes.error.message}`);
      }

      // (d) The triggers already gated this; a success here is a real one.
      return { membershipId: input.membershipId, isAdmin: input.targetRole === "admin" };
    },
  };
}
