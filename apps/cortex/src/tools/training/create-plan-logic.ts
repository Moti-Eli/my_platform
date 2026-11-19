/**
 * Training — the SERVER WIRING for the privileged `training.create_plan` intent.
 *
 * SERVER-ONLY. The seam between the framework-free {@link createTrainingPlanCore}
 * and the runtime that has the clients: it resolves the actor's RLS client and
 * takes the service client, then calls the core. It imports node-crypto-bearing
 * code, so the client runtime injects a throwing stub instead of importing this
 * (mirrors shopping/create-list-logic.ts).
 */
import "server-only";

import type { SupabaseClient } from "@platform/db";
import type { Ctx } from "@platform/cortex-core";
import { createTrainingPlanCore } from "./create-plan-core";
import type { CreatePlanInput, CreatePlanResult } from "./logic";

export function createTrainingCreatePlan({
  getRls,
  service,
}: {
  getRls: () => Promise<SupabaseClient>;
  service: SupabaseClient;
}) {
  return async function createPlan(input: CreatePlanInput, ctx: Ctx): Promise<CreatePlanResult> {
    const rlsDb = await getRls();
    const res = await createTrainingPlanCore(
      { rlsDb, serviceDb: service },
      {
        name: input.name,
        description: input.description,
        frequencyPerWeek: input.frequencyPerWeek,
        userId: ctx.userId,
      },
    );
    // A stable error key; runIntentAction maps unknown keys to a generic failure.
    if ("error" in res) throw new Error(res.error);
    return res;
  };
}
