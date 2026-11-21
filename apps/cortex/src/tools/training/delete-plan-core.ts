/**
 * deleteTrainingPlanCore — delete a plan (with its days and exercises), then
 * hide its org.
 *
 * FRAMEWORK-FREE ON PURPOSE, like shopping/delete-list-core.ts: both clients
 * injected. Same order as shopping, plus an owner gate:
 *   (0) OWNER ONLY — the plan's owner_id must be the caller. RLS lets every
 *       member write, so this is the tool's own rule, checked first.
 *   (a) PRE-CHECK the two refusals `hideOrganizationForCurrentUser` would give —
 *       the org is the caller's LAST active org, or it has OTHER active members.
 *       Checked BEFORE anything is deleted, so a refusal leaves the plan intact.
 *   (b) delete the plan through the RLS client; its days go with it and their
 *       exercises with them (composite FK cascades).
 *   (c) hide the org (a soft delete — it does not cascade to tool rows, which is
 *       why (b) comes first).
 * If (c) still fails after (a) passed, the plan is already gone and the empty org
 * stays visible; that is reported as `hideFailed` so the screen can say so.
 */
import type { SupabaseClient } from "@platform/db";
import { getUserOrganizations, hideOrganizationForCurrentUser } from "@platform/auth";

export interface DeleteTrainingPlanDeps {
  /** Actor-scoped (their JWT). The owner read, org list, plan delete, hide gate. */
  rlsDb: SupabaseClient;
  /** Service-role. The authoritative member count and the hide's UPDATE. */
  serviceDb: SupabaseClient;
}

export interface DeleteTrainingPlanInput {
  planId: string;
  /** The ACTIVE org, from the session's ctx — the plan must live in it. */
  orgId: string;
  userId: string;
}

export type DeleteTrainingPlanResult =
  | { deleted: true }
  | { error: "notOwner" | "lastOrg" | "otherMembers" | "hideFailed" | "deleteFailed" };

export async function deleteTrainingPlanCore(
  { rlsDb, serviceDb }: DeleteTrainingPlanDeps,
  { planId, orgId, userId }: DeleteTrainingPlanInput,
): Promise<DeleteTrainingPlanResult> {
  // (0) Owner only.
  const planRes = await rlsDb
    .from("workout_plans")
    .select("owner_id")
    .eq("id", planId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (planRes.error || !planRes.data) return { error: "deleteFailed" };
  if ((planRes.data as { owner_id: string }).owner_id !== userId) return { error: "notOwner" };

  // (a) The same two guards hide applies, checked first.
  const orgs = await getUserOrganizations(rlsDb, userId);
  if (orgs.length <= 1) return { error: "lastOrg" };
  const members = await serviceDb
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .is("deleted_at", null);
  if (members.error) return { error: "deleteFailed" };
  if ((members.count ?? 0) > 1) return { error: "otherMembers" };

  // (b) The plan (and, by cascade, its days and exercises), through RLS.
  const del = await rlsDb
    .from("workout_plans")
    .delete()
    .eq("id", planId)
    .eq("org_id", orgId)
    .select("id");
  if (del.error || (del.data ?? []).length === 0) return { error: "deleteFailed" };

  // (c) Hide the now-empty org.
  const hide = await hideOrganizationForCurrentUser(rlsDb, serviceDb, { organizationId: orgId });
  if (hide.error) return { error: "hideFailed" };

  return { deleted: true };
}
