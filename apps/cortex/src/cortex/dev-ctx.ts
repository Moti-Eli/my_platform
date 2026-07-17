/**
 * DEV ONLY — replace when auth lands.
 *
 * Cortex has no auth wired yet, so we pass a single hard-coded context to
 * `runIntent`/`emit`. When real auth arrives, DELETE THIS FILE ENTIRELY and
 * derive `Ctx` from the shell's session (userId) and the active organization
 * (orgId). Nothing else should need to change — every handler already receives
 * `ctx` from the shell.
 *
 * `instanceId` is NOT hard-coded here, and no dev value exists for it. It is
 * audit metadata only (see `Ctx`), it is nullable, and it must stay NULL:
 * `app_instances` has zero rows, so any invented uuid would violate
 * `events.emitted_by_instance` / `ai_log.target_instance_id`'s FK the moment a
 * real adapter replaces the in-memory one. It becomes real when installed-apps
 * moves off localStorage — not before.
 */
import type { Ctx } from "@platform/cortex-core";

// DEV ONLY — fixed identifiers standing in for a real session and active org.
export const DEV_USER_ID = "00000000-0000-0000-0000-00000000d001";
export const DEV_ORG_ID = "00000000-0000-0000-0000-00000000d0a1";

// DEV ONLY — the context every Inventory call runs under until auth lands.
export const DEV_CTX: Ctx = {
  userId: DEV_USER_ID,
  orgId: DEV_ORG_ID,
  instanceId: null,
};
