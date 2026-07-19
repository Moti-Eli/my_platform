/**
 * Notes — the AI API ("the connection file", Standard §4).
 *
 * The AI never sees a table; it sees this list of actions and their zod schemas.
 * Handlers delegate to `logic` (the only code that touches the db client) and
 * receive `ctx` from the shell — they never fetch it or write SQL themselves.
 * Every name is `notes.<action>`.
 *
 * NOTE (injected, not singleton): `logic` needs the db client + event-bus, which
 * are created at runtime, so intents are produced by `createNotesIntents(logic)`
 * rather than importing a global `notesLogic` singleton. Same shapes as §4,
 * dependencies injected instead of global.
 *
 * ONE SHAPE DIFFERENCE FROM TASKS: a note has an editable `body`, so instead of
 * tasks' boolean `toggle_task` there is `update_note`, which edits `title`/`body`.
 */
import { z } from "zod";
import { defineIntent } from "@platform/cortex-core";
import type { NotesLogic } from "./logic";

/** One note as returned to the AI/views. `body` is always a string ('' when the
 * note has no body — the column defaults to '', never null). */
const note = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
});

export function createNotesIntents(logic: NotesLogic) {
  return [
    defineIntent({
      name: "notes.query_list",
      description: "List the notes in the current organization",
      input: z.object({}),
      output: z.array(note),
      handler: (input, ctx) => logic.queryList(input, ctx),
    }),

    defineIntent({
      name: "notes.create_note",
      description: "Create a new note, optionally with a body",
      input: z.object({
        title: z.string(),
        body: z.string().optional(),
      }),
      output: z.object({ id: z.string() }),
      handler: (input, ctx) => logic.createNote(input, ctx),
    }),

    defineIntent({
      name: "notes.update_note",
      description: "Edit a note's title and/or body",
      input: z.object({
        id: z.string(),
        title: z.string().optional(),
        body: z.string().optional(),
      }),
      output: z.object({ id: z.string() }),
      handler: (input, ctx) => logic.updateNote(input, ctx),
    }),

    defineIntent({
      name: "notes.delete_note",
      description: "Delete a note",
      input: z.object({ id: z.string() }),
      output: z.object({ id: z.string() }),
      handler: (input, ctx) => logic.deleteNote(input, ctx),
    }),
  ];
}
