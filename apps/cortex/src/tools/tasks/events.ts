/**
 * Tasks — events (Standard §5).
 *
 * Emits (from logic.ts): 'tasks.created', 'tasks.completed'.
 *
 * Listens:
 *   'inventory.low' → auto-create a "Reorder: {product}" task. This is the FIRST
 *   cross-app event chain in Cortex: inventory emits low-stock, tasks reacts by
 *   creating work, and neither tool references the other — the event-bus + registry
 *   are the only coupling.
 *
 * WHY A FACTORY, NOT A STATIC ARRAY: a listener's handler is (payload, ctx) and
 * receives NO db/logic. To WRITE (create a task) it must CLOSE OVER the tasks logic
 * at registration time — exactly as `createTasksIntents(logic)` does for intents. So
 * listeners are produced by `createTasksListeners(logic)`, and server-runtime/runtime
 * register its result where they register the intents. It reuses `logic.createTask`
 * (the SAME create path the tasks intent uses), so the insert is never duplicated.
 *
 * LOOP SAFETY: createTask emits 'tasks.created', which has NO subscribers, and this
 * listener subscribes only to 'inventory.low'. Creating a task never emits
 * 'inventory.low', so the chain terminates — it cannot re-trigger itself.
 */
import { defineListener, type AnyListener } from "@platform/cortex-core";
import { dictionaries } from "@/i18n/dictionaries";
import { defaultLocale } from "@/i18n/config";
import type { TasksLogic } from "./logic";

/** Payload of `inventory.low` (emitted by inventory/logic.ts on add and on update). */
interface InventoryLowPayload {
  product: string;
  quantity: number;
  threshold: number;
}

export function createTasksListeners(logic: TasksLogic): AnyListener[] {
  return [
    defineListener<InventoryLowPayload>("inventory.low", async (payload, ctx) => {
      // Title from i18n, never a hardcoded string. The chain runs server-side with no
      // user locale in ctx, so resolve against the DEFAULT locale and interpolate the
      // product name (the value carries a single "{product}" placeholder).
      const title = dictionaries[defaultLocale].tasks.autoReorderTitle.replace(
        "{product}",
        payload.product,
      );

      // KNOWN GAP (deliberate, later step): NO idempotency — this creates a NEW task
      // on every inventory.low, so an item bouncing below threshold accumulates
      // duplicate reorder tasks. Skipping when an open reorder task for that product
      // already exists is a separate step; not built here.

      // Reuse the tool's own create path: owner_id/org_id come from ctx exactly as a
      // normal task creation, and omitting dueDate stores due_date NULL.
      await logic.createTask({ title }, ctx);
    }),
  ];
}
