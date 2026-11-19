/**
 * Training — the SERVER WIRING for the privileged `training.delete_plan` intent.
 *
 * SERVER-ONLY, same seam as create-plan-logic.ts (and shopping's
 * delete-list-logic.ts): resolves the actor's RLS client, takes the service
 * client, calls the framework-free core. The client runtime injects a throwing
 * stub instead of importing this.
 */
import "server-only";

import type { SupabaseClient } from "@platform/db";
import type { Ctx } from "@platform/cortex-core";
import { deleteTrainingPlanCore } from "./delete-plan-core";
import type { DeletePlanInput, DeletePlanResult } from "./logic";

export function createTrainingDeletePlan({
  getRls,
  service,
}: {
  getRls: () => Promise<SupabaseClient>;
  service: SupabaseClient;
}) {
  return async function deletePlan(input: DeletePlanInput, ctx: Ctx): Promise<DeletePlanResult> {
    const rlsDb = await getRls();
    const res = await deleteTrainingPlanCore(
      { rlsDb, serviceDb: service },
      { planId: input.id, orgId: ctx.orgId, userId: ctx.userId },
    );
    // The refusals the screen explains are RETURNED (not thrown), so they reach
    // it as data; anything else is a generic failure.
    if (!("error" in res)) return res;
    if (res.error === "deleteFailed") throw new Error(res.error);
    return { error: res.error };
  };
}
