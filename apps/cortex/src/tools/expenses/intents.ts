/**
 * Expenses — the AI API ("the connection file", Standard §4).
 *
 * The AI never sees a table; it sees this list of actions and their zod schemas.
 * Handlers delegate to `logic` (the only code that touches the db client) and
 * receive `ctx` from the shell — they never fetch it or write SQL themselves.
 * Every name is `expenses.<action>`.
 *
 * NOTE (injected, not singleton): `logic` needs the db client + event-bus, which
 * are created at runtime, so intents are produced by `createExpensesIntents(logic)`
 * rather than importing a global `expensesLogic` singleton. Same shapes as §4,
 * dependencies injected instead of global.
 */
import { z } from "zod";
import { defineIntent } from "@platform/cortex-core";
import type { ExpensesLogic } from "./logic";

/** One expense as returned to the AI/views. `amount` is a number; `category`,
 * `spentOn` (an ISO date) and `note` are always strings — the columns default,
 * so none is ever null. */
const expense = z.object({
  id: z.string(),
  amount: z.number(),
  category: z.string(),
  spentOn: z.string(),
  note: z.string(),
});

export function createExpensesIntents(logic: ExpensesLogic) {
  return [
    defineIntent({
      name: "expenses.query_list",
      description: "List the expenses in the current organization",
      input: z.object({}),
      output: z.array(expense),
      handler: (input, ctx) => logic.queryList(input, ctx),
    }),

    defineIntent({
      name: "expenses.create_expense",
      description: "Record a new expense; only the amount is required",
      input: z.object({
        amount: z.number(),
        category: z.string().optional(),
        spentOn: z.string().optional(),
        note: z.string().optional(),
      }),
      output: z.object({ id: z.string() }),
      handler: (input, ctx) => logic.createExpense(input, ctx),
    }),

    defineIntent({
      name: "expenses.update_expense",
      description: "Edit an expense's amount, category, date and/or note",
      input: z.object({
        id: z.string(),
        amount: z.number().optional(),
        category: z.string().optional(),
        spentOn: z.string().optional(),
        note: z.string().optional(),
      }),
      output: z.object({ id: z.string() }),
      handler: (input, ctx) => logic.updateExpense(input, ctx),
    }),

    defineIntent({
      name: "expenses.delete_expense",
      description: "Delete an expense",
      input: z.object({ id: z.string() }),
      output: z.object({ id: z.string() }),
      handler: (input, ctx) => logic.deleteExpense(input, ctx),
    }),
  ];
}
