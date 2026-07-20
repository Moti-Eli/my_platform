// SERVER-ONLY. Builds the data-layer on the Supabase adapter (which holds the
// secret-key client). `server-only` makes importing it from a Client Component a
// build error.
import "server-only";

import {
  createDataLayer,
  createEventBus,
  registerApp,
  getApp,
  type DataLayer,
} from "@platform/cortex-core";
import { manifest } from "@/tools/inventory/manifest";
import { createInventoryLogic } from "@/tools/inventory/logic";
import { createInventoryIntents } from "@/tools/inventory/intents";
import { listeners } from "@/tools/inventory/events";
import { manifest as tasksManifest } from "@/tools/tasks/manifest";
import { createTasksLogic } from "@/tools/tasks/logic";
import { createTasksIntents } from "@/tools/tasks/intents";
import { createTasksListeners } from "@/tools/tasks/events";
import { manifest as staffManifest } from "@/tools/staff/manifest";
import { createStaffLogic } from "@/tools/staff/logic";
import { createStaffIntents } from "@/tools/staff/intents";
import { listeners as staffListeners } from "@/tools/staff/events";
import { manifest as notesManifest } from "@/tools/notes/manifest";
import { createNotesLogic } from "@/tools/notes/logic";
import { createNotesIntents } from "@/tools/notes/intents";
import { createNotesListeners } from "@/tools/notes/events";
import { manifest as expensesManifest } from "@/tools/expenses/manifest";
import { createExpensesLogic } from "@/tools/expenses/logic";
import { createExpensesIntents } from "@/tools/expenses/intents";
import { createExpensesListeners } from "@/tools/expenses/events";
import { manifest as journalManifest } from "@/tools/journal/manifest";
import { createJournalLogic } from "@/tools/journal/logic";
import { createJournalIntents } from "@/tools/journal/intents";
import { createJournalListeners } from "@/tools/journal/events";
import { STUB_APPS } from "@/tools/stub-apps";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createCortexAdminClient } from "@/lib/supabase/admin";
import { createSupabaseCortexDb } from "./supabase-db";

/**
 * The SERVER composition root: the same tools registered by `runtime.ts`, wired
 * to the Supabase-backed {@link CortexDb} instead of the in-memory Map.
 *
 * ── "REGISTERING ON BOTH SIDES" IS NOT DUPLICATED STATE ───────────────────
 * `runtime.ts` (client) also calls `registerApp`. That is fine: the registry is
 * DERIVED FROM CODE — it lists which tools exist, computed the same way wherever
 * it runs — and the server and client are separate module instances in separate
 * bundles, so they populate independent registries. There is no shared mutable
 * state being written twice; there are two processes each computing the same
 * function of the same source. This module keeps its OWN memo (`ready`) and does
 * NOT reach into runtime.ts's — crossing that memo across the server/client
 * boundary is exactly the confusion to avoid.
 *
 * ── WHY THE MEMO IS SAFE (no cross-request identity leak) ─────────────────
 * The data-layer is memoized process-wide, and the tool logic it registers is
 * baked into the global registry once. That is only safe because the adapter's
 * `rls` client is resolved PER OPERATION from the current request's cookies (see
 * supabase-db.ts) — never a fixed per-request instance frozen into the memo. The
 * `service` client is stateless, so sharing it is fine. If you ever change the
 * adapter to take a fixed rls client, this memo becomes a security bug: request
 * B would read as request A.
 *
 * ── PERMISSION CHECKER: defaultAssertPermissions STAYS (next debt) ────────
 * We deliberately pass NO custom permission checker, so `createDataLayer` uses
 * `defaultAssertPermissions` (app registered + ctx has a userId). The real
 * RBAC checker is a later step: the inventory manifest declares permissions
 * ("org.read" / "org.write") that DO NOT EXIST in `public.permissions` yet, so a
 * real checker resolving them would deny every call for a reason unrelated to
 * this step. RLS is still fully enforced beneath this — the row-level access
 * model does not depend on the manifest checker. Wire the real checker when the
 * permission vocabulary and the org-role model land.
 */

let ready: Promise<DataLayer> | null = null;

function build(): DataLayer {
  // Throws loudly if the secret key is absent — the audit write on every call
  // depends on it, so it must fail with the reason named, not degrade to "no rows".
  const service = createCortexAdminClient();

  // Resolved per operation, inside the request, so each read carries the right
  // user's JWT. Throws if the public env is absent (a real misconfiguration).
  // Shared by the CortexDb adapter AND staff logic — staff reads existing platform
  // tables (memberships/roles/users) through @platform/auth with THIS same per-user
  // RLS client, never the service client.
  const getRls = async () => {
    const rls = await createSupabaseServerClient();
    if (!rls) {
      throw new Error(
        "Cortex server runtime: NEXT_PUBLIC_SUPABASE_URL / " +
          "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are not set."
      );
    }
    return rls;
  };

  const db = createSupabaseCortexDb({ getRls, service });

  const dataLayer = createDataLayer({ db });
  const eventBus = createEventBus(db);

  // Same registerApp calls as runtime.ts — real tool + stubs. Idempotent via the
  // getApp guard, so this is safe even though runtime.ts may also have run in a
  // different (client) bundle.
  const inventoryLogic = createInventoryLogic({ db, emit: eventBus.emit });
  if (!getApp(manifest.id)) {
    registerApp(manifest, createInventoryIntents(inventoryLogic), listeners);
  }
  const tasksLogic = createTasksLogic({ db, emit: eventBus.emit });
  if (!getApp(tasksManifest.id)) {
    // The listeners CLOSE OVER tasksLogic so the inventory.low → create-a-reorder-task
    // chain can write through the tasks tool's own create path. Same logic instance
    // the intents use.
    registerApp(tasksManifest, createTasksIntents(tasksLogic), createTasksListeners(tasksLogic));
  }
  // Staff reads through the RLS client directly (not the CortexDb), because it uses
  // @platform/auth's multi-table getOrganizationMembers — see staff/logic.ts. It also
  // takes the `service` client for the privileged add_member writes (user/profile/
  // membership), while the role assignment inside addMemberToOrg runs on the RLS client.
  const staffLogic = createStaffLogic({ getRls, service });
  if (!getApp(staffManifest.id)) {
    registerApp(staffManifest, createStaffIntents(staffLogic), staffListeners);
  }
  const notesLogic = createNotesLogic({ db, emit: eventBus.emit });
  if (!getApp(notesManifest.id)) {
    registerApp(notesManifest, createNotesIntents(notesLogic), createNotesListeners(notesLogic));
  }
  const expensesLogic = createExpensesLogic({ db, emit: eventBus.emit });
  if (!getApp(expensesManifest.id)) {
    registerApp(
      expensesManifest,
      createExpensesIntents(expensesLogic),
      createExpensesListeners(expensesLogic),
    );
  }
  const journalLogic = createJournalLogic({ db, emit: eventBus.emit });
  if (!getApp(journalManifest.id)) {
    registerApp(
      journalManifest,
      createJournalIntents(journalLogic),
      createJournalListeners(journalLogic),
    );
  }
  for (const stub of STUB_APPS) {
    if (!getApp(stub.id)) registerApp(stub);
  }

  return dataLayer;
}

/** Lazily build the server data-layer once, then reuse it. Safe to memo — see header. */
export function getServerRuntime(): Promise<DataLayer> {
  if (ready) return ready;

  ready = (async (): Promise<DataLayer> => build())().catch((err: unknown) => {
    // Never let a build failure (e.g. missing secret key) vanish. Log, drop the
    // memo so the next call retries, then re-reject.
    console.error("Cortex server runtime: init failed", err);
    ready = null;
    throw err;
  });

  return ready;
}
