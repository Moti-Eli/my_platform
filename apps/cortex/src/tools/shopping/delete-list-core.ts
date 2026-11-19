/**
 * deleteShoppingListCore — delete a list, then hide its org.
 *
 * FRAMEWORK-FREE ON PURPOSE, like create-list-core.ts: both clients injected.
 *
 * THE ORDER (Cortex-Roadmap.md, "Shopping lists"):
 *   (a) PRE-CHECK the two refusals `hideOrganizationForCurrentUser` would give —
 *       the org is the caller's LAST active org, or it has OTHER active members.
 *       Checked BEFORE anything is deleted, so a refusal leaves the list intact.
 *   (b) delete the list through the RLS client; its items go with it (FK cascade).
 *   (c) hide the org (`hideOrganizationForCurrentUser`, a soft delete — it does
 *       not cascade to tool rows, which is why (b) comes first).
 * If (c) still fails after (a) passed (a DB error, or a member joined in between),
 * the list is already gone and the empty org stays visible; that is reported as
 * `hideFailed` so the screen can say so.
 */
import type { SupabaseClient } from "@platform/db";
import { getUserOrganizations, hideOrganizationForCurrentUser } from "@platform/auth";

export interface DeleteShoppingListDeps {
  /** Actor-scoped (their JWT). The org list, the list delete, the hide gate. */
  rlsDb: SupabaseClient;
  /** Service-role. The authoritative member count and the hide's UPDATE. */
  serviceDb: SupabaseClient;
}

export interface DeleteShoppingListInput {
  listId: string;
  /** The ACTIVE org, from the session's ctx — the list must live in it. */
  orgId: string;
  userId: string;
}

export type DeleteShoppingListResult =
  | { deleted: true }
  | { error: "lastOrg" | "otherMembers" | "hideFailed" | "deleteFailed" };

export async function deleteShoppingListCore(
  { rlsDb, serviceDb }: DeleteShoppingListDeps,
  { listId, orgId, userId }: DeleteShoppingListInput,
): Promise<DeleteShoppingListResult> {
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

  // (b) The list (and, by cascade, its items), through the actor's RLS client.
  //     Zero rows deleted means RLS refused or the list is not in this org.
  const del = await rlsDb
    .from("shopping_lists")
    .delete()
    .eq("id", listId)
    .eq("org_id", orgId)
    .select("id");
  if (del.error || (del.data ?? []).length === 0) return { error: "deleteFailed" };

  // (c) Hide the now-empty org.
  const hide = await hideOrganizationForCurrentUser(rlsDb, serviceDb, { organizationId: orgId });
  if (hide.error) return { error: "hideFailed" };

  return { deleted: true };
}
