/**
 * Training — the AI API ("the connection file", Standard §4).
 *
 * Handlers delegate to `logic` and receive `ctx` from the shell. Every name is
 * `training.<action>`. Length caps mirror the table CHECK constraints.
 */
import { z } from "zod";
import { defineIntent } from "@platform/cortex-core";
import {
  FREQUENCY_MAX,
  FREQUENCY_MIN,
  PLAN_DESCRIPTION_MAX,
  PLAN_NAME_MAX,
  type TrainingLogic,
} from "./logic";

const plan = z.object({
  id: z.string(),
  orgId: z.string(),
  ownerId: z.string(),
  name: z.string(),
  description: z.string(),
  frequencyPerWeek: z.number().int().nullable(),
  createdAt: z.string(),
});
const planName = z.string().trim().min(1).max(PLAN_NAME_MAX);
const planDescription = z.string().trim().max(PLAN_DESCRIPTION_MAX);
const frequency = z.number().int().min(FREQUENCY_MIN).max(FREQUENCY_MAX).nullable();

export function createTrainingIntents(logic: TrainingLogic) {
  return [
    // READ. The active org's plan — null when the active org is not a plan org.
    defineIntent({
      name: "training.get_plan",
      description: "Get the workout plan of the current organization, or null if it has none",
      input: z.object({}),
      output: plan.nullable(),
      handler: (input, ctx) => logic.getPlan(input, ctx),
    }),
    // READ. Every plan the user is in, across their orgs ("My plans").
    defineIntent({
      name: "training.list_plans",
      description: "List all of the user's workout plans (each lives in its own organization)",
      input: z.object({}),
      output: z.array(plan),
      handler: (input, ctx) => logic.listPlans(input, ctx),
    }),
    // Creates the plan's own root organization, installs this tool there and
    // inserts the plan. The caller then switches to the returned org.
    defineIntent({
      name: "training.create_plan",
      description:
        "Create a new workout plan (name, optional description and workouts per week) in its own small organization and return the plan and organization ids",
      input: z.object({ name: planName, description: planDescription, frequencyPerWeek: frequency }),
      output: z.object({ planId: z.string(), orgId: z.string() }),
      handler: (input, ctx) => logic.createPlan(input, ctx),
    }),
    defineIntent({
      name: "training.update_plan",
      description: "Change the workout plan's name, description and workouts per week",
      input: z.object({
        id: z.string(),
        name: planName,
        description: planDescription,
        frequencyPerWeek: frequency,
      }),
      output: z.object({ id: z.string() }),
      handler: (input, ctx) => logic.updatePlan(input, ctx),
    }),
    // Owner only. Deletes the plan with its days and exercises, then hides its
    // org. Refused — with the plan left intact — when the caller is not the
    // owner, the org is their last, or it has other members.
    defineIntent({
      name: "training.delete_plan",
      description:
        "Delete the workout plan with all its days and exercises and hide its organization (owner only)",
      input: z.object({ id: z.string() }),
      output: z.union([
        z.object({ deleted: z.literal(true) }),
        z.object({ error: z.enum(["notOwner", "lastOrg", "otherMembers", "hideFailed"]) }),
      ]),
      handler: (input, ctx) => logic.deletePlan(input, ctx),
    }),
  ];
}
