/**
 * Shopping — the SERVER WIRING for the privileged `shopping.delete_list` intent.
 *
 * SERVER-ONLY, same seam as create-list-logic.ts: resolves the actor's RLS client,
 * takes the service client, calls the framework-free core. The client runtime
 * injects a throwing stub instead of importing this.
 */
import "server-only";

import type { SupabaseClient } from "@platform/db";
import type { Ctx } from "@platform/cortex-core";
import { deleteShoppingListCore } from "./delete-list-core";
import type { DeleteListInput, DeleteListResult } from "./logic";

export function createShoppingDeleteList({
  getRls,
  service,
}: {
  getRls: () => Promise<SupabaseClient>;
  service: SupabaseClient;
}) {
  return async function deleteList(input: DeleteListInput, ctx: Ctx): Promise<DeleteListResult> {
    const rlsDb = await getRls();
    const res = await deleteShoppingListCore(
      { rlsDb, serviceDb: service },
      { listId: input.id, orgId: ctx.orgId, userId: ctx.userId },
    );
    // The refusals the screen explains are RETURNED (not thrown), so they reach
    // it as data; anything else is a generic failure.
    if (!("error" in res)) return res;
    if (res.error === "deleteFailed") throw new Error(res.error);
    return { error: res.error };
  };
}
