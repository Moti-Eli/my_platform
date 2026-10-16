/**
 * Journal — the AI API ("the connection file", Standard §4).
 *
 * The AI never sees a table; it sees this list of actions and their zod schemas.
 * Handlers delegate to `logic` (the only code that touches the db client) and
 * receive `ctx` from the shell — they never fetch it or write SQL themselves.
 * Every name is `journal.<action>`.
 *
 * NOTE (injected, not singleton): `logic` needs the db client + event-bus, which
 * are created at runtime, so intents are produced by `createJournalIntents(logic)`
 * rather than importing a global `journalLogic` singleton. Same shapes as §4,
 * dependencies injected instead of global.
 */
import { z } from "zod";
import { defineIntent } from "@platform/cortex-core";
import type { JournalLogic } from "./logic";

/** One entry as returned to the AI/views. `content` and `entryDate` (an ISO date)
 * are always strings; `mood` is NULLABLE — the one optional column — so it is `null`
 * when unset, never coerced to ''. */
const entry = z.object({
  id: z.string(),
  entryDate: z.string(),
  content: z.string(),
  mood: z.string().nullable(),
});

export function createJournalIntents(logic: JournalLogic) {
  return [
    defineIntent({
      name: "journal.query_list",
      description: "List the journal entries in the current organization",
      input: z.object({}),
      output: z.array(entry),
      handler: (input, ctx) => logic.queryList(input, ctx),
    }),

    defineIntent({
      name: "journal.create_entry",
      description: "Add a new journal entry; only the content is required",
      input: z.object({
        content: z.string(),
        entryDate: z.string().optional(),
        mood: z.string().optional(),
      }),
      output: z.object({ id: z.string() }),
      handler: (input, ctx) => logic.createEntry(input, ctx),
    }),

    defineIntent({
      name: "journal.update_entry",
      description: "Edit an entry's content, date and/or mood",
      input: z.object({
        id: z.string(),
        content: z.string().optional(),
        entryDate: z.string().optional(),
        mood: z.string().optional(),
      }),
      output: z.object({ id: z.string() }),
      handler: (input, ctx) => logic.updateEntry(input, ctx),
    }),

    defineIntent({
      name: "journal.delete_entry",
      description: "Delete a journal entry",
      input: z.object({ id: z.string() }),
      output: z.object({ id: z.string() }),
      handler: (input, ctx) => logic.deleteEntry(input, ctx),
    }),
  ];
}
