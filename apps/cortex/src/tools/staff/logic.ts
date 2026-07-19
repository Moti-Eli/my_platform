/**
 * Staff — internal business logic (Standard §2 `logic.ts`). READ-ONLY this step.
 *
 * Unlike inventory/tasks, staff has NO table of its own: it reads the EXISTING
 * platform tables (memberships / roles / users) through `@platform/auth`'s
 * `getOrganizationMembers`, which runs as the current user so RLS returns only the
 * caller's org and only co-members' profiles.
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

export interface StaffLogic {
  listMembers(input: ListMembersInput, ctx: Ctx): Promise<Member[]>;
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
  };
}
