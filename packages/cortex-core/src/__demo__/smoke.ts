/**
 * Cortex core smoke demo — the acceptance test (core prompt task 7).
 *
 * Throwaway proof that the four core pieces work together end-to-end, with ZERO
 * UI and no live database:
 *
 *   1. register a dummy "ping" app: one intent `ping.echo` + one listener on
 *      the event `ping.fired`;
 *   2. call runIntent('ping.echo', { msg: 'hi' }, ctx) and show the result;
 *   3. emit('ping.fired', …) and show the listener ran;
 *   4. confirm a row was written to `ai_log` (and to `events`).
 *
 * The `ai_log`/`events` writes go through the same {@link CortexDb} port a real
 * Supabase adapter implements — here backed by the in-memory adapter, so the
 * exact `insert('ai_log', …)` / `insert('events', …)` code path is exercised
 * without needing the migration applied.
 *
 * Run:  pnpm --filter @platform/cortex-core smoke
 * Exits non-zero if any assertion fails.
 */

import { z } from "zod";

import {
  registerApp,
  clearRegistry,
  createDataLayer,
  createEventBus,
  createInMemoryDb,
  type AppManifest,
  type Ctx,
  type Intent,
  type Listener,
} from "../index";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    console.error(`  ✗ ${message}`);
    throw new Error(`Smoke assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function main(): Promise<void> {
  console.log("Cortex core smoke test\n");
  clearRegistry(); // clean slate in case this module is re-imported

  // --- 1. A dummy "ping" tool ------------------------------------------------
  const manifest: AppManifest = {
    id: "ping",
    version: "0.1.0",
    name: { key: "ping.name" },
    category: "demo",
    icon: "activity",
    color: "primary",
    permissions: [],
    roles: [],
    requires: [],
    emits: ["ping.fired"],
    listensTo: ["ping.fired"],
    aiTopics: ["ping.echo"],
  };

  const EchoIO = z.object({ msg: z.string() });

  const echo: Intent<{ msg: string }, { msg: string }> = {
    name: "ping.echo",
    description: "Echo the given message back.",
    input: EchoIO,
    output: EchoIO,
    async handler(input) {
      return { msg: input.msg };
    },
  };

  // A listener that records whether it ran (proving decoupled dispatch).
  let listenerRan = false;
  let listenerSawMsg: string | null = null;
  const onFired: Listener<{ msg: string }> = {
    eventType: "ping.fired",
    async handler(payload) {
      listenerRan = true;
      listenerSawMsg = payload.msg;
    },
  };

  registerApp(manifest, [echo], [onFired]);
  console.log("Registered app 'ping' (1 intent, 1 listener).\n");

  // --- Wire the core to an in-memory db --------------------------------------
  const db = createInMemoryDb();
  const { runIntent } = createDataLayer({ db });
  const { emit } = createEventBus(db);

  const ctx: Ctx = {
    userId: "00000000-0000-0000-0000-000000000001",
    orgId: "00000000-0000-0000-0000-0000000000aa",
    instanceId: "00000000-0000-0000-0000-0000000000ff",
  };

  // --- 2. runIntent ----------------------------------------------------------
  console.log("runIntent('ping.echo', { msg: 'hi' }):");
  const result = await runIntent<{ msg: string }>("ping.echo", { msg: "hi" }, ctx);
  console.log(`  -> ${JSON.stringify(result)}`);
  assert(result.msg === "hi", "runIntent returned the echoed message");

  // --- 3. emit + listener ----------------------------------------------------
  console.log("\nemit('ping.fired', { msg: 'boom' }):");
  await emit("ping.fired", { msg: "boom" }, ctx);
  assert(listenerRan, "the 'ping.fired' listener ran");
  assert(listenerSawMsg === "boom", "the listener received the emitted payload");

  // --- 4. audit + event persistence ------------------------------------------
  console.log("\nPersistence:");
  assert(db.count("ai_log") === 1, "exactly one row was written to ai_log");
  const logRow = db.rows("ai_log")[0]!;
  assert(logRow.intent === "ping.echo", "ai_log row records the intent name");
  assert(logRow.user_id === ctx.userId, "ai_log row records the acting user");
  assert(
    logRow.target_instance_id === ctx.instanceId,
    "ai_log row records the target instance",
  );
  assert(db.count("events") === 1, "exactly one row was written to events");
  const eventRow = db.rows("events")[0]!;
  assert(eventRow.type === "ping.fired", "events row records the event type");
  assert(
    eventRow.emitted_by_instance === ctx.instanceId,
    "events row records the emitting instance",
  );

  console.log("\n✅ Smoke test passed — registry + runIntent + event-bus + db all work.");
}

main().catch((err) => {
  console.error("\n❌ Smoke test FAILED\n", err);
  process.exit(1);
});
