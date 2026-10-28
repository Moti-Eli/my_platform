/**
 * Shopping — the SERVER WIRING for the privileged `shopping.create_list` intent.
 *
 * SERVER-ONLY. The seam between the framework-free {@link createShoppingListCore}
 * and the runtime that has the clients: it resolves the actor's RLS client and
 * takes the service client, then calls the core. It imports node-crypto-bearing
 * code, so the client runtime injects a throwing stub instead of importing this
 * (mirrors candidates/invite-logic.ts).
 */
import "server-only";

import type { SupabaseClient } from "@platform/db";
import type { Ctx } from "@platform/cortex-core";
import { createShoppingListCore } from "./create-list-core";
import type { CreateListInput, CreateListResult } from "./logic";

export function createShoppingCreateList({
  getRls,
  service,
}: {
  getRls: () => Promise<SupabaseClient>;
  service: SupabaseClient;
}) {
  return async function createList(input: CreateListInput, ctx: Ctx): Promise<CreateListResult> {
    const rlsDb = await getRls();
    const res = await createShoppingListCore(
      { rlsDb, serviceDb: service },
      { name: input.name, userId: ctx.userId },
    );
    // A stable error key; runIntentAction maps unknown keys to a generic failure.
    if ("error" in res) throw new Error(res.error);
    return res;
  };
}
