/**
 * DEV ONLY — replace when auth lands.
 *
 * Cortex has no auth wired yet, so we pass a single hard-coded context to
 * `runIntent`/`emit`. When real auth arrives, delete this file and derive `Ctx`
 * from the shell's session (userId), the active organization (orgId), and the
 * selected tool instance (instanceId). Nothing else should need to change —
 * every handler already receives `ctx` from the shell.
 */
import type { Ctx } from "@platform/cortex-core";

// DEV ONLY — fixed identifiers standing in for a real session/org/instance.
export const DEV_USER_ID = "00000000-0000-0000-0000-00000000d001";
export const DEV_ORG_ID = "00000000-0000-0000-0000-00000000d0a1";
export const DEV_INVENTORY_INSTANCE_ID = "00000000-0000-0000-0000-00000000d0ff";

// DEV ONLY — the context every Inventory call runs under until auth lands.
export const DEV_CTX: Ctx = {
  userId: DEV_USER_ID,
  orgId: DEV_ORG_ID,
  instanceId: DEV_INVENTORY_INSTANCE_ID,
};
