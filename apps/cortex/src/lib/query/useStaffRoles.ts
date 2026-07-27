"use client";

/**
 * react-query hook for the org's ROLES (read-only). Cloned from `useStaffMembers`,
 * same conventions and same shared-cache discipline.
 *
 * The queryFn calls the SERVER action `runIntentAction("staff.list_roles")`, which
 * builds ctx from `requireSession()` on every call — so a background refetch is
 * re-authenticated exactly like the first fetch, and the RLS-scoped selects run
 * with the caller's JWT. No identity is passed from here; there is no field to pass.
 *
 * `runIntentAction` returns a discriminated result rather than throwing, so a
 * `!res.ok` becomes a thrown Error(res.code): react-query treats only a REJECTED
 * queryFn as an error, and we want `isError` to reflect a denied/failed read.
 *
 * ONE query key, separate from the members list (`["staff","roles"]`): the roles
 * section and the members list read different shapes but share the same cache, so
 * both staff views stay in sync without re-fetching each other's data.
 */
import { useQuery } from "@tanstack/react-query";
import { runIntentAction } from "@/cortex/actions";
import type { RolesData } from "@/tools/staff/logic";

/** The single queryKey the roles section shares. */
export const STAFF_ROLES_KEY = ["staff", "roles"] as const;

export function useStaffRoles() {
  const query = useQuery({
    queryKey: STAFF_ROLES_KEY,
    queryFn: async (): Promise<RolesData> => {
      const res = await runIntentAction("staff.list_roles", {});
      if (!res.ok) throw new Error(res.code);
      return res.data as RolesData;
    },
  });

  // Typed, always-defined lists so callers never branch on `data === undefined`.
  const roles = query.data?.roles ?? [];
  const memberRoles = query.data?.memberRoles ?? [];

  return { ...query, roles, memberRoles };
}
