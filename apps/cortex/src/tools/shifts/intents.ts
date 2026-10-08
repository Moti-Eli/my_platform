/**
 * Shifts — the AI API ("the connection file", Standard §4).
 *
 * Handlers delegate to `logic` and receive `ctx` from the shell. Every name is
 * `shifts.<action>`. Length caps mirror the table CHECK constraints.
 */
import { z } from "zod";
import { defineIntent } from "@platform/cortex-core";
import type { ShiftsLogic } from "./logic";

/** Mirrors shift_positions.name CHECK (1–100). */
export const POSITION_NAME_MAX = 100;
/** A sane cap on how many positions one reorder may carry. */
const REORDER_MAX = 200;

const position = z.object({ id: z.string(), name: z.string(), position: z.number() });
const positionName = z.string().trim().min(1).max(POSITION_NAME_MAX);
const id = z.object({ id: z.string() });

export function createShiftsIntents(logic: ShiftsLogic) {
  return [
    defineIntent({
      name: "shifts.list_positions",
      description: "List the restaurant's job positions (waiter, cook…) in the current organization",
      input: z.object({}),
      output: z.array(position),
      handler: (input, ctx) => logic.listPositions(input, ctx),
    }),
    defineIntent({
      name: "shifts.create_position",
      description: "Add a job position (e.g. waiter, cook, bartender)",
      input: z.object({ name: positionName, position: z.number().int().min(0) }),
      output: id,
      handler: (input, ctx) => logic.createPosition(input, ctx),
    }),
    defineIntent({
      name: "shifts.rename_position",
      description: "Rename a job position",
      input: z.object({ id: z.string(), name: positionName }),
      output: id,
      handler: (input, ctx) => logic.renamePosition(input, ctx),
    }),
    defineIntent({
      name: "shifts.reorder_positions",
      description: "Set the display order of the job positions",
      input: z.object({ ids: z.array(z.string()).min(1).max(REORDER_MAX) }),
      output: z.object({ count: z.number() }),
      handler: (input, ctx) => logic.reorderPositions(input, ctx),
    }),
    defineIntent({
      name: "shifts.delete_position",
      description: "Delete a job position (refused while a shift still requires it)",
      input: id,
      output: id,
      handler: (input, ctx) => logic.deletePosition(input, ctx),
    }),
  ];
}
