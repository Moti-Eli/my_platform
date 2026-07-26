/**
 * Time entries — the AI API ("the connection file", Standard §4).
 *
 * The AI never sees a table; it sees this list of actions and their zod schemas.
 * Handlers delegate to `logic` (the only code that touches the db client) and
 * receive `ctx` from the shell — they never fetch it or write SQL themselves.
 * Every name is `time_entries.<action>`.
 *
 * NOTE (injected, not singleton): `logic` needs the db client + event-bus, which
 * are created at runtime, so intents are produced by `createTimeEntriesIntents(logic)`
 * rather than importing a global singleton. Same shapes as §4, dependencies injected.
 */
import { z } from "zod";
import { defineIntent } from "@platform/cortex-core";
import type { TimeEntriesLogic } from "./logic";

/** One entry as returned to the AI/views. `workDate` (an ISO date) and `note` are
 * always strings; `hours` is a number in the domain (0, 24]. */
const entry = z.object({
  id: z.string(),
  workDate: z.string(),
  hours: z.number(),
  note: z.string(),
});

/** The hours domain — strictly greater than 0, at most 24 — the SAME bound as the
 * DB CHECK and the client-side validation. */
const hours = z.number().gt(0).lte(24);

export function createTimeEntriesIntents(logic: TimeEntriesLogic) {
  return [
    defineIntent({
      name: "time_entries.query_list",
      description: "List the time entries in the current organization",
      input: z.object({}),
      output: z.array(entry),
      handler: (input, ctx) => logic.queryList(input, ctx),
    }),

    defineIntent({
      name: "time_entries.create_entry",
      description: "Add a new time entry; hours is required and must be in (0, 24]",
      input: z.object({
        hours,
        workDate: z.string().optional(),
        note: z.string().optional(),
      }),
      output: z.object({ id: z.string() }),
      handler: (input, ctx) => logic.createEntry(input, ctx),
    }),

    defineIntent({
      name: "time_entries.update_entry",
      description: "Edit a time entry's hours, date and/or note",
      input: z.object({
        id: z.string(),
        hours: hours.optional(),
        workDate: z.string().optional(),
        note: z.string().optional(),
      }),
      output: z.object({ id: z.string() }),
      handler: (input, ctx) => logic.updateEntry(input, ctx),
    }),

    defineIntent({
      name: "time_entries.delete_entry",
      description: "Delete a time entry",
      input: z.object({ id: z.string() }),
      output: z.object({ id: z.string() }),
      handler: (input, ctx) => logic.deleteEntry(input, ctx),
    }),
  ];
}
