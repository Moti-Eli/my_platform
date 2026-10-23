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
/** A sane cap on how many rows one batch call may carry. */
const BATCH_MAX = 500;

const position = z.object({ id: z.string(), name: z.string(), position: z.number() });
const accessLevel = z.enum(["employee", "shift_lead"]);
const employee = z.object({ id: z.string(), userId: z.string(), accessLevel });
const orgMember = z.object({
  userId: z.string(),
  email: z.string(),
  displayName: z.string().nullable(),
});
const employeePosition = z.object({
  id: z.string(),
  employeeId: z.string(),
  positionId: z.string(),
});
const positionName = z.string().trim().min(1).max(POSITION_NAME_MAX);
const id = z.object({ id: z.string() });

/** The "note to the manager" cap (the table allows 500; the product says one line). */
export const SUBMISSION_NOTE_MAX = 200;
/** Mirrors shift_submissions.min_shifts / max_shifts CHECK (0–99). */
export const SHIFTS_COUNT_MAX = 99;

/** Mirrors shift_requirements.required_count CHECK (1–99; 0 = no row). */
export const REQUIRED_MAX = 99;

/** Mirrors shift_templates.name CHECK (1–50). */
export const SHIFT_NAME_MAX = 50;
const weekday = z.number().int().min(0).max(6);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const shiftName = z.string().trim().min(1).max(SHIFT_NAME_MAX);
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const weekInput = z.object({ weekStart: isoDay });
const shiftWeek = z.object({ id: z.string(), weekStart: z.string(), deadlineAt: z.string() });
const weekReopen = z.object({
  id: z.string(),
  employeeId: z.string(),
  weekStart: z.string(),
  reopenedUntil: z.string(),
});
const mark = z.enum(["cannot", "prefer"]);
const availabilityMark = z.object({
  id: z.string(),
  submissionId: z.string(),
  templateId: z.string(),
  mark,
});
const submission = z.object({
  id: z.string(),
  employeeId: z.string(),
  weekStart: z.string(),
  minShifts: z.number().nullable(),
  maxShifts: z.number().nullable(),
  doubleShift: z.enum(["yes", "no", "if_needed"]).nullable(),
  note: z.string(),
  answers: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])),
  submittedAt: z.string().nullable(),
  updatedAt: z.string(),
});
const template = z.object({
  id: z.string(),
  weekday: z.number(),
  name: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  updatedAt: z.string(),
});
/** Equal start/end is refused (the DB CHECK too); end < start = next day. */
const hasLength = (v: { startTime: string; endTime: string }) => v.startTime !== v.endTime;

export function createShiftsIntents(logic: ShiftsLogic) {
  return [
    // --- access -------------------------------------------------------------
    defineIntent({
      name: "shifts.my_access",
      description:
        "Whether the current user is a manager of the shifts tool and/or an employee taking part in shifts",
      input: z.object({}),
      output: z.object({ isAdmin: z.boolean(), isEmployee: z.boolean() }),
      handler: (input, ctx) => logic.myAccess(input, ctx),
    }),

    // --- the employee's week (stage 2) --------------------------------------
    defineIntent({
      name: "shifts.my_week",
      description:
        "The current user's availability submission for a week (its Sunday as YYYY-MM-DD): the week's deadline settings, their submission and their marks",
      input: weekInput,
      output: z.object({
        week: shiftWeek.nullable(),
        reopen: weekReopen.nullable(),
        submission: submission.nullable(),
        marks: z.array(availabilityMark),
      }),
      handler: (input, ctx) => logic.myWeek(input, ctx),
    }),
    defineIntent({
      name: "shifts.set_mark",
      description:
        "Mark one shift in the current user's week as cannot / prefer, or can (removes the mark). Refused after the week's deadline",
      input: weekInput.extend({ templateId: z.string().min(1), mark: z.enum(["can", "cannot", "prefer"]) }),
      output: z.object({ submissionId: z.string(), mark: availabilityMark.nullable() }),
      handler: (input, ctx) => logic.setMark(input, ctx),
    }),
    defineIntent({
      name: "shifts.set_answers",
      description:
        "Answer the built-in weekly questions for the current user: how many shifts (min/max, sent together), double shifts (yes/no/if_needed), a one-line note. Only the fields sent change. Refused after the deadline",
      input: weekInput
        .extend({
          minShifts: z.number().int().min(0).max(SHIFTS_COUNT_MAX).nullable().optional(),
          maxShifts: z.number().int().min(0).max(SHIFTS_COUNT_MAX).nullable().optional(),
          doubleShift: z.enum(["yes", "no", "if_needed"]).nullable().optional(),
          note: z.string().trim().max(SUBMISSION_NOTE_MAX).optional(),
        })
        .refine(
          (v) => v.minShifts == null || v.maxShifts == null || v.minShifts <= v.maxShifts,
          { message: "max must not be below min" },
        ),
      output: z.object({ submissionId: z.string(), updatedAt: z.string() }),
      handler: (input, ctx) => logic.setAnswers(input, ctx),
    }),
    defineIntent({
      name: "shifts.week_overview",
      description:
        "The manager's view of a week (its Sunday as YYYY-MM-DD): the deadline settings, every employee's submission and marks",
      input: weekInput,
      output: z.object({
        week: shiftWeek.nullable(),
        submissions: z.array(submission),
        marks: z.array(availabilityMark),
      }),
      handler: (input, ctx) => logic.weekOverview(input, ctx),
    }),
    defineIntent({
      name: "shifts.submit_week",
      description: "Submit (or re-submit) the current user's availability for a week. Refused after the deadline",
      input: weekInput,
      output: z.object({ submissionId: z.string(), submittedAt: z.string() }),
      handler: (input, ctx) => logic.submitWeek(input, ctx),
    }),

    // --- positions ----------------------------------------------------------
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
      input: z.object({ ids: z.array(z.string()).min(1).max(BATCH_MAX) }),
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

    // --- org members + employees in the tool --------------------------------
    defineIntent({
      name: "shifts.list_org_members",
      description: "List the active members of the current organization (candidates for the shifts tool)",
      input: z.object({}),
      output: z.array(orgMember),
      handler: (input, ctx) => logic.listOrgMembers(input, ctx),
    }),
    defineIntent({
      name: "shifts.list_employees",
      description: "List the members taking part in shifts",
      input: z.object({}),
      output: z.array(employee),
      handler: (input, ctx) => logic.listEmployees(input, ctx),
    }),
    defineIntent({
      name: "shifts.add_employees",
      description: "Add one or more org members to the shifts tool",
      input: z.object({ userIds: z.array(z.string().min(1)).min(1).max(BATCH_MAX) }),
      output: z.object({ created: z.array(employee), failed: z.array(z.string()) }),
      handler: (input, ctx) => logic.addEmployees(input, ctx),
    }),
    defineIntent({
      name: "shifts.set_access_level",
      description: "Set an employee's access level in the shifts tool (employee or shift lead)",
      input: z.object({ id: z.string(), accessLevel }),
      output: id,
      handler: (input, ctx) => logic.setAccessLevel(input, ctx),
    }),
    defineIntent({
      name: "shifts.remove_employee",
      description: "Remove a member from the shifts tool (their positions go with them)",
      input: id,
      output: id,
      handler: (input, ctx) => logic.removeEmployee(input, ctx),
    }),

    // --- employee ↔ position links ------------------------------------------
    defineIntent({
      name: "shifts.list_employee_positions",
      description: "List which positions each employee can fill",
      input: z.object({}),
      output: z.array(employeePosition),
      handler: (input, ctx) => logic.listEmployeePositions(input, ctx),
    }),
    defineIntent({
      name: "shifts.list_my_positions",
      description: "List the positions the current user can fill in the current organization",
      input: z.object({}),
      output: z.array(position),
      handler: (input, ctx) => logic.listMyPositions(input, ctx),
    }),
    defineIntent({
      name: "shifts.assign_position",
      description: "Let an employee fill a position",
      input: z.object({ employeeId: z.string().min(1), positionId: z.string().min(1) }),
      output: id,
      handler: (input, ctx) => logic.assignPosition(input, ctx),
    }),
    defineIntent({
      name: "shifts.unassign_position",
      description: "Remove a position from an employee",
      input: id,
      output: id,
      handler: (input, ctx) => logic.unassignPosition(input, ctx),
    }),

    // --- weekly shift templates ---------------------------------------------
    defineIntent({
      name: "shifts.list_templates",
      description: "List the recurring weekly shifts (0 = Sunday … 6 = Saturday)",
      input: z.object({}),
      output: z.array(template),
      handler: (input, ctx) => logic.listTemplates(input, ctx),
    }),
    defineIntent({
      name: "shifts.create_template",
      description:
        "Add a recurring shift on a weekday (HH:MM times; an end earlier than the start ends the next day)",
      input: z
        .object({ weekday, name: shiftName, startTime: hhmm, endTime: hhmm })
        .refine(hasLength, { message: "start and end must differ" }),
      output: id,
      handler: (input, ctx) => logic.createTemplate(input, ctx),
    }),
    defineIntent({
      name: "shifts.update_template",
      description: "Rename a recurring shift or change its hours",
      input: z
        .object({ id: z.string(), name: shiftName, startTime: hhmm, endTime: hhmm })
        .refine(hasLength, { message: "start and end must differ" }),
      output: id,
      handler: (input, ctx) => logic.updateTemplate(input, ctx),
    }),
    defineIntent({
      name: "shifts.delete_template",
      description: "Delete a recurring shift (its staffing requirements go with it)",
      input: id,
      output: id,
      handler: (input, ctx) => logic.deleteTemplate(input, ctx),
    }),
    defineIntent({
      name: "shifts.copy_day_to_all",
      description:
        "Replace every other weekday's shifts with copies of one day's shifts, including their staffing requirements",
      input: z.object({ weekday }),
      output: z.object({
        deleted: z.number(),
        created: z.number(),
        requirementsCopied: z.number(),
      }),
      handler: (input, ctx) => logic.copyDayToAll(input, ctx),
    }),

    // --- staffing requirements ----------------------------------------------
    defineIntent({
      name: "shifts.list_requirements",
      description: "List how many people of each position every shift needs",
      input: z.object({}),
      output: z.array(
        z.object({
          id: z.string(),
          templateId: z.string(),
          positionId: z.string(),
          requiredCount: z.number(),
        }),
      ),
      handler: (input, ctx) => logic.listRequirements(input, ctx),
    }),
    defineIntent({
      name: "shifts.set_requirement",
      description:
        "Set how many people of a position a shift needs (0 = not needed, which removes the requirement)",
      input: z.object({
        templateId: z.string().min(1),
        positionId: z.string().min(1),
        count: z.number().int().min(0).max(REQUIRED_MAX),
      }),
      output: z.object({ id: z.string().nullable() }),
      handler: (input, ctx) => logic.setRequirement(input, ctx),
    }),
  ];
}
