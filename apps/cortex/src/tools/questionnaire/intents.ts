/**
 * Questionnaire — the AI API ("the connection file", Standard §4). Exactly two
 * intents: the read `questionnaire.query_list` and the single write
 * `questionnaire.answer` ({ id, answer } → the updated row).
 *
 * Handlers delegate to `logic` (the only code that touches the db client) and
 * receive `ctx` from the shell — they never fetch identity or write SQL themselves.
 * Injected, not singleton: `createQuestionnaireIntents(logic)` (logic needs the db
 * client, created at runtime).
 */
import { z } from "zod";
import { defineIntent } from "@platform/cortex-core";
import type { QuestionnaireLogic } from "./logic";

/** One questionnaire row as returned to the AI/views. `questionText` is the frozen
 * snapshot of the question; `answer` is '' until answered; `position` orders them. */
const row = z.object({
  id: z.string(),
  questionKey: z.string(),
  questionText: z.string(),
  answer: z.string(),
  position: z.number(),
});

export function createQuestionnaireIntents(logic: QuestionnaireLogic) {
  return [
    defineIntent({
      name: "questionnaire.query_list",
      description: "List the current organization's questionnaire rows, ordered by position",
      input: z.object({}),
      output: z.array(row),
      handler: (input, ctx) => logic.queryList(input, ctx),
    }),

    defineIntent({
      name: "questionnaire.answer",
      description: "Save the answer to one questionnaire question; returns the updated row",
      input: z.object({ id: z.string(), answer: z.string() }),
      output: row,
      handler: (input, ctx) => logic.answer(input, ctx),
    }),
  ];
}
