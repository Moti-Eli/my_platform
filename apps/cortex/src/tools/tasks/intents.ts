/**
 * Tasks — the AI API ("the connection file", Standard §4).
 *
 * The AI never sees a table; it sees this list of actions and their zod schemas.
 * Handlers delegate to `logic` (the only code that touches the db client / emits
 * events) and receive `ctx` from the shell — they never fetch it or write SQL
 * themselves. Every name is `tasks.<action>`.
 *
 * NOTE (injected, not singleton): `logic` needs the db client + event-bus, which
 * are created at runtime, so intents are produced by `createTasksIntents(logic)`
 * rather than importing a global `tasksLogic` singleton. Same shapes as §4,
 * dependencies injected instead of global.
 */
import { z } from "zod";
import { defineIntent } from "@platform/cortex-core";
import type { TasksLogic } from "./logic";

/** One task as returned to the AI/views. `dueDate` is nullable (a task need not
 * have a due date); `done` drives the per-row toggle visual. */
const task = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
  dueDate: z.string().nullable(),
});

export function createTasksIntents(logic: TasksLogic) {
  return [
    defineIntent({
      name: "tasks.query_list",
      description: "List the tasks in the current organization",
      input: z.object({}),
      output: z.array(task),
      handler: (input, ctx) => logic.queryList(input, ctx),
    }),

    defineIntent({
      name: "tasks.create_task",
      description: "Create a new task, optionally with a due date",
      input: z.object({
        title: z.string(),
        dueDate: z.string().optional(),
      }),
      output: z.object({ id: z.string() }),
      // → emits tasks.created (see logic + events.ts)
      handler: (input, ctx) => logic.createTask(input, ctx),
    }),

    defineIntent({
      name: "tasks.toggle_task",
      description: "Mark a task done or not done",
      input: z.object({
        id: z.string(),
        done: z.boolean(),
      }),
      output: z.object({ id: z.string(), done: z.boolean() }),
      // → may emit tasks.completed when a task transitions into done
      handler: (input, ctx) => logic.toggleTask(input, ctx),
    }),

    defineIntent({
      name: "tasks.delete_task",
      description: "Delete a task",
      input: z.object({ id: z.string() }),
      output: z.object({ id: z.string() }),
      handler: (input, ctx) => logic.deleteTask(input, ctx),
    }),
  ];
}
