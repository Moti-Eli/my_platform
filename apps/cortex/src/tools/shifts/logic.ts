/**
 * Shifts — internal business logic (Standard §2 `logic.ts`).
 *
 * The ONLY place shifts touches its data. Tool tables go through the provided
 * `CortexDb` (never raw SQL); it receives `ctx` from the shell and never fetches
 * identity itself.
 *
 * Stage 1: POSITIONS (part 1), EMPLOYEES in the tool + which positions each can
 * fill (part 2), the WEEKLY SHIFT TEMPLATES with "copy a day to all days"
 * (part 3), and STAFFING REQUIREMENTS — how many of each position a shift
 * needs (part 4). Stage 2 (availability): `myAccess` (who the acting user is
 * to the tool), then the EMPLOYEE's OWN week — read in one call (`myWeek`),
 * marks saved one tap at a time (`setMark`), the built-in questions
 * (`setAnswers`), "Submit" (`submitWeek`), and the MANAGER's view of a
 * week (`weekOverview`). The
 * deadline is enforced HERE (`assertOpen`), not in RLS — see deadline.ts.
 *
 * THE ORG MEMBER LIST comes from `@platform/auth`'s `getOrganizationMembers`,
 * through the SAME per-user RLS client the staff tool uses (`getRls`, injected —
 * see staff/logic.ts for why a logic takes `getRls` rather than the CortexDb).
 * The memberships SELECT policy already hides soft-deleted memberships, so
 * someone who LEFT the org is simply not in that list — and the views hide any
 * shift_employees row whose user is not in it (decision: hide, don't delete).
 *
 * RLS is the enforcement point: reads are open to the org tree, every write
 * needs `shifts.manage` (managers). The `org_id` filters are CONTEXT filters.
 * Writes do not set `visibility` — it defaults to 'org'.
 */
import type { SupabaseClient } from "@platform/db";
import { getOrganizationMembers } from "@platform/auth";
import { safeRandomUUID, type Ctx, type CortexDb, type DbRow } from "@platform/cortex-core";
import { isWeekOpenFor } from "./deadline";

export const POSITIONS_TABLE = "shift_positions";
export const EMPLOYEES_TABLE = "shift_employees";
export const EMPLOYEE_POSITIONS_TABLE = "shift_employee_positions";
export const TEMPLATES_TABLE = "shift_templates";
export const REQUIREMENTS_TABLE = "shift_requirements";
// Stage 2 (migrations 20261022000001–06).
export const WEEKS_TABLE = "shift_weeks";
export const SUBMISSIONS_TABLE = "shift_submissions";
export const MARKS_TABLE = "shift_availability_marks";
export const REOPENS_TABLE = "shift_week_reopens";

export type AccessLevel = "employee" | "shift_lead";

export interface Position {
  id: string;
  name: string;
  /** Display order (ascending). Ties sort by name. */
  position: number;
}

/** An ACTIVE member of the org (soft-deleted memberships are already excluded). */
export interface OrgMember {
  userId: string;
  email: string;
  displayName: string | null;
}

/** A member taking part in shifts (a shift_employees row). */
export interface Employee {
  id: string;
  userId: string;
  accessLevel: AccessLevel;
}

/** One "employee can fill position" link (a shift_employee_positions row). */
export interface EmployeePosition {
  id: string;
  employeeId: string;
  positionId: string;
}

/** A recurring weekly shift (a shift_templates row). */
export interface ShiftTemplate {
  id: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  name: string;
  /** "HH:MM" local time. */
  startTime: string;
  /** "HH:MM" local time; earlier than startTime = ends the next day. */
  endTime: string;
  /** ISO instant — later than an employee's submittedAt means "changed after
   * they submitted" (stage 2). */
  updatedAt: string;
}

/** How many people of one position a shift needs (a shift_requirements row). */
export interface ShiftRequirement {
  id: string;
  templateId: string;
  positionId: string;
  requiredCount: number;
}

/** The manager's settings for one week (a shift_weeks row). No row = defaults. */
export interface ShiftWeek {
  id: string;
  /** The week's Sunday, "YYYY-MM-DD". */
  weekStart: string;
  /** ISO instant. */
  deadlineAt: string;
}

/** "Reopen for one employee" (a shift_week_reopens row). */
export interface WeekReopen {
  id: string;
  employeeId: string;
  weekStart: string;
  /** ISO instant. */
  reopenedUntil: string;
}

export type DoubleShift = "yes" | "no" | "if_needed";

/** One employee's weekly submission (a shift_submissions row). */
export interface Submission {
  id: string;
  employeeId: string;
  weekStart: string;
  minShifts: number | null;
  maxShifts: number | null;
  doubleShift: DoubleShift | null;
  note: string;
  /** shift_questions.id → answer. */
  answers: Record<string, boolean | number | string>;
  /** ISO instant; null = saved, not submitted. */
  submittedAt: string | null;
  /** ISO instant — later than submittedAt means "changed since submitting". */
  updatedAt: string;
}

/** A mark on one shift. No row = can. */
export type Mark = "cannot" | "prefer";
export interface AvailabilityMark {
  id: string;
  submissionId: string;
  templateId: string;
  mark: Mark;
}

/** Everything the employee's week screen needs, in one read. */
export interface MyWeek {
  week: ShiftWeek | null;
  reopen: WeekReopen | null;
  submission: Submission | null;
  marks: AvailabilityMark[];
}

export interface WeekInput {
  /** The week's Sunday, "YYYY-MM-DD". */
  weekStart: string;
}
export interface SetMarkInput extends WeekInput {
  templateId: string;
  /** "can" removes the mark (no row). */
  mark: Mark | "can";
}
export interface SetMarkResult {
  submissionId: string;
  mark: AvailabilityMark | null;
}
/** The built-in questions' answers. Only the fields sent are changed; min and
 * max always travel together (the pair is validated as one). */
export interface SetAnswersInput extends WeekInput {
  minShifts?: number | null;
  maxShifts?: number | null;
  doubleShift?: DoubleShift | null;
  note?: string;
}
export interface SetAnswersResult {
  submissionId: string;
  updatedAt: string;
}
export interface SubmitWeekResult {
  submissionId: string;
  submittedAt: string;
}

/** The manager's view of one week: everyone's submissions and marks (RLS: an
 * org admin reads every private row; a plain member would get only their own). */
export interface WeekOverview {
  week: ShiftWeek | null;
  submissions: Submission[];
  marks: AvailabilityMark[];
}

/** The acting user's standing in the tool (stage 2, part 1: who sees what). */
export interface MyAccess {
  /** Org admin in the active org (from ctx — the shell's convenience flag). */
  isAdmin: boolean;
  /** Has a shift_employees row in the active org. */
  isEmployee: boolean;
}

/** Every list_* takes no input — the org comes from ctx, not the caller. */
export interface ListInput {}
export interface IdInput {
  id: string;
}
export interface CreatePositionInput {
  name: string;
  /** Where to put it — the views send "after the last one". */
  position: number;
}
export interface RenamePositionInput {
  id: string;
  name: string;
}
export interface ReorderPositionsInput {
  /** Every position id, in the new display order. */
  ids: string[];
}
export interface AddEmployeesInput {
  /** Org members to add to the tool (one or "everyone"). */
  userIds: string[];
}
export interface AddEmployeesResult {
  created: Employee[];
  /** userIds whose insert failed (e.g. added meanwhile by someone else). */
  failed: string[];
}
export interface SetAccessLevelInput {
  id: string;
  accessLevel: AccessLevel;
}
export interface AssignPositionInput {
  employeeId: string;
  positionId: string;
}
export interface CreateTemplateInput {
  weekday: number;
  name: string;
  startTime: string;
  endTime: string;
}
export interface UpdateTemplateInput {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
}
export interface SetRequirementInput {
  templateId: string;
  positionId: string;
  /** 0 = "not needed": the row is removed. 1–99 = needed. */
  count: number;
}
export interface CopyDayInput {
  /** The day whose shifts (and their requirements) replace every other day's. */
  weekday: number;
}
export interface CopyDayResult {
  /** Shifts removed from the other days (their requirements went with them). */
  deleted: number;
  /** Shifts created on the other days. */
  created: number;
  /** Requirement rows copied along with them. */
  requirementsCopied: number;
}

export interface ShiftsLogic {
  myAccess(input: ListInput, ctx: Ctx): Promise<MyAccess>;

  myWeek(input: WeekInput, ctx: Ctx): Promise<MyWeek>;
  setMark(input: SetMarkInput, ctx: Ctx): Promise<SetMarkResult>;
  setAnswers(input: SetAnswersInput, ctx: Ctx): Promise<SetAnswersResult>;
  submitWeek(input: WeekInput, ctx: Ctx): Promise<SubmitWeekResult>;
  weekOverview(input: WeekInput, ctx: Ctx): Promise<WeekOverview>;

  listPositions(input: ListInput, ctx: Ctx): Promise<Position[]>;
  createPosition(input: CreatePositionInput, ctx: Ctx): Promise<{ id: string }>;
  renamePosition(input: RenamePositionInput, ctx: Ctx): Promise<{ id: string }>;
  reorderPositions(input: ReorderPositionsInput, ctx: Ctx): Promise<{ count: number }>;
  deletePosition(input: IdInput, ctx: Ctx): Promise<{ id: string }>;

  listOrgMembers(input: ListInput, ctx: Ctx): Promise<OrgMember[]>;
  listEmployees(input: ListInput, ctx: Ctx): Promise<Employee[]>;
  addEmployees(input: AddEmployeesInput, ctx: Ctx): Promise<AddEmployeesResult>;
  setAccessLevel(input: SetAccessLevelInput, ctx: Ctx): Promise<{ id: string }>;
  removeEmployee(input: IdInput, ctx: Ctx): Promise<{ id: string }>;

  listEmployeePositions(input: ListInput, ctx: Ctx): Promise<EmployeePosition[]>;
  listMyPositions(input: ListInput, ctx: Ctx): Promise<Position[]>;
  assignPosition(input: AssignPositionInput, ctx: Ctx): Promise<{ id: string }>;
  unassignPosition(input: IdInput, ctx: Ctx): Promise<{ id: string }>;

  listTemplates(input: ListInput, ctx: Ctx): Promise<ShiftTemplate[]>;
  createTemplate(input: CreateTemplateInput, ctx: Ctx): Promise<{ id: string }>;
  updateTemplate(input: UpdateTemplateInput, ctx: Ctx): Promise<{ id: string }>;
  deleteTemplate(input: IdInput, ctx: Ctx): Promise<{ id: string }>;
  copyDayToAll(input: CopyDayInput, ctx: Ctx): Promise<CopyDayResult>;

  listRequirements(input: ListInput, ctx: Ctx): Promise<ShiftRequirement[]>;
  setRequirement(input: SetRequirementInput, ctx: Ctx): Promise<{ id: string | null }>;
}

/** The event-bus surface the logic needs (from `@platform/cortex-core`). */
type Emit = (type: string, payload: unknown, ctx: Ctx) => Promise<void>;

function toPosition(row: DbRow): Position {
  return { id: String(row.id), name: String(row.name), position: Number(row.position ?? 0) };
}

function toEmployee(row: DbRow): Employee {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    accessLevel: row.access_level === "shift_lead" ? "shift_lead" : "employee",
  };
}

function toEmployeePosition(row: DbRow): EmployeePosition {
  return {
    id: String(row.id),
    employeeId: String(row.employee_id),
    positionId: String(row.position_id),
  };
}

/** Postgres `time` comes back as "HH:MM:SS" — the app works in "HH:MM". */
const hhmm = (v: unknown) => String(v ?? "").slice(0, 5);

function toTemplate(row: DbRow): ShiftTemplate {
  return {
    id: String(row.id),
    weekday: Number(row.weekday),
    name: String(row.name),
    startTime: hhmm(row.start_time),
    endTime: hhmm(row.end_time),
    updatedAt: String(row.updated_at ?? ""),
  };
}

function toRequirement(row: DbRow): ShiftRequirement {
  return {
    id: String(row.id),
    templateId: String(row.template_id),
    positionId: String(row.position_id),
    requiredCount: Number(row.required_count),
  };
}

/** Postgres `date` comes back as "YYYY-MM-DD" (sometimes longer) — keep the date. */
const isoDay = (v: unknown) => String(v ?? "").slice(0, 10);

function toWeek(row: DbRow): ShiftWeek {
  return { id: String(row.id), weekStart: isoDay(row.week_start), deadlineAt: String(row.deadline_at) };
}

function toReopen(row: DbRow): WeekReopen {
  return {
    id: String(row.id),
    employeeId: String(row.employee_id),
    weekStart: isoDay(row.week_start),
    reopenedUntil: String(row.reopened_until),
  };
}

function toSubmission(row: DbRow): Submission {
  const ds = row.double_shift;
  return {
    id: String(row.id),
    employeeId: String(row.employee_id),
    weekStart: isoDay(row.week_start),
    minShifts: row.min_shifts == null ? null : Number(row.min_shifts),
    maxShifts: row.max_shifts == null ? null : Number(row.max_shifts),
    doubleShift: ds === "yes" || ds === "no" || ds === "if_needed" ? ds : null,
    note: row.note == null ? "" : String(row.note),
    answers:
      row.answers && typeof row.answers === "object"
        ? (row.answers as Record<string, boolean | number | string>)
        : {},
    submittedAt: row.submitted_at == null ? null : String(row.submitted_at),
    updatedAt: String(row.updated_at),
  };
}

function toMark(row: DbRow): AvailabilityMark {
  return {
    id: String(row.id),
    submissionId: String(row.submission_id),
    templateId: String(row.template_id),
    mark: row.mark === "prefer" ? "prefer" : "cannot",
  };
}

/** The mandatory fields (§6) every insert carries. `visibility` defaults to 'org'. */
function ownership(ctx: Ctx, now: string) {
  return { owner_id: ctx.userId, org_id: ctx.orgId, created_at: now, updated_at: now };
}

export function createShiftsLogic({
  db,
  emit: _emit,
  getRls,
}: {
  db: CortexDb;
  emit: Emit;
  /** The per-user RLS client factory — server-side only (throws on the client). */
  getRls: () => Promise<SupabaseClient>;
}): ShiftsLogic {
  // --- stage-2 helpers (the acting EMPLOYEE's own rows) -------------------
  /** The acting user's shift_employees row, or a thrown "notInTool". */
  async function myEmployeeRow(ctx: Ctx): Promise<{ id: string }> {
    const [me] = await db.select(EMPLOYEES_TABLE, { org_id: ctx.orgId, user_id: ctx.userId });
    if (!me) throw new Error("shifts: notInTool");
    return { id: String(me.id) };
  }

  async function weekSettings(weekStart: string, employeeId: string, ctx: Ctx) {
    const [week] = await db.select(WEEKS_TABLE, { org_id: ctx.orgId, week_start: weekStart });
    const [reopen] = await db.select(REOPENS_TABLE, {
      org_id: ctx.orgId,
      employee_id: employeeId,
      week_start: weekStart,
    });
    return { week: week ? toWeek(week) : null, reopen: reopen ? toReopen(reopen) : null };
  }

  /** THE deadline check (the server action is the only write path). */
  async function assertOpen(weekStart: string, employeeId: string, ctx: Ctx) {
    const { week, reopen } = await weekSettings(weekStart, employeeId, ctx);
    if (!isWeekOpenFor(new Date(), weekStart, week, reopen)) throw new Error("shifts: weekClosed");
  }

  async function mySubmission(weekStart: string, employeeId: string, ctx: Ctx) {
    const [row] = await db.select(SUBMISSIONS_TABLE, {
      org_id: ctx.orgId,
      employee_id: employeeId,
      week_start: weekStart,
    });
    return row ? toSubmission(row) : null;
  }

  /** The employee's submission row for the week, created on first use. BORN
   * private, owned by the employee (stamped explicitly — the DB default is the
   * fail-safe half, as on time_entries). */
  async function ensureSubmission(weekStart: string, employeeId: string, ctx: Ctx) {
    const existing = await mySubmission(weekStart, employeeId, ctx);
    if (existing) return existing;
    const id = safeRandomUUID();
    const now = new Date().toISOString();
    await db.insert(SUBMISSIONS_TABLE, {
      id,
      ...ownership(ctx, now),
      visibility: "private",
      employee_id: employeeId,
      week_start: weekStart,
    });
    return {
      id,
      employeeId,
      weekStart,
      minShifts: null,
      maxShifts: null,
      doubleShift: null,
      note: "",
      answers: {},
      submittedAt: null,
      updatedAt: now,
    } satisfies Submission;
  }

  return {
    // --- access -------------------------------------------------------------
    async myAccess(_input, ctx) {
      // What the screens OFFER, never what the DB allows (RLS decides that).
      // shift_employees is readable by every org member, so this read works for
      // a plain employee too.
      const rows = await db.select(EMPLOYEES_TABLE, { org_id: ctx.orgId, user_id: ctx.userId });
      return { isAdmin: ctx.isAdmin, isEmployee: rows.length > 0 };
    },

    // --- the employee's week (stage 2) --------------------------------------
    async myWeek(input, ctx) {
      // RLS already narrows submissions/marks to the OWNER (private rows); the
      // employee_id / owner filters are context, not security.
      const me = await myEmployeeRow(ctx);
      const { week, reopen } = await weekSettings(input.weekStart, me.id, ctx);
      const submission = await mySubmission(input.weekStart, me.id, ctx);
      const marks = submission
        ? (await db.select(MARKS_TABLE, { submission_id: submission.id })).map(toMark)
        : [];
      return { week, reopen, submission, marks };
    },

    async setMark(input, ctx) {
      // One tap = one call: "can" deletes the row, else update-or-insert. The
      // submission's updated_at is bumped too, so "changed since submitting" is
      // one comparison for the screen.
      const me = await myEmployeeRow(ctx);
      await assertOpen(input.weekStart, me.id, ctx);
      const submission = await ensureSubmission(input.weekStart, me.id, ctx);
      const now = new Date().toISOString();
      const [existing] = await db.select(MARKS_TABLE, {
        submission_id: submission.id,
        template_id: input.templateId,
      });
      let mark: AvailabilityMark | null = null;
      if (input.mark === "can") {
        if (existing) await db.delete(MARKS_TABLE, { id: String(existing.id) });
      } else if (existing) {
        await db.update(MARKS_TABLE, { id: String(existing.id) }, { mark: input.mark, updated_at: now });
        mark = { ...toMark(existing), mark: input.mark };
      } else {
        const id = safeRandomUUID();
        await db.insert(MARKS_TABLE, {
          id,
          ...ownership(ctx, now),
          visibility: "private",
          submission_id: submission.id,
          template_id: input.templateId,
          mark: input.mark,
        });
        mark = { id, submissionId: submission.id, templateId: input.templateId, mark: input.mark };
      }
      await db.update(SUBMISSIONS_TABLE, { id: submission.id }, { updated_at: now });
      return { submissionId: submission.id, mark };
    },

    async setAnswers(input, ctx) {
      // The built-in questions (part 4): each change saves at once. Only the
      // fields present in the input are written; updated_at is bumped so
      // "changed since submitting" is one comparison for the screen.
      const me = await myEmployeeRow(ctx);
      await assertOpen(input.weekStart, me.id, ctx);
      const submission = await ensureSubmission(input.weekStart, me.id, ctx);
      const now = new Date().toISOString();
      const patch: DbRow = { updated_at: now };
      if (input.minShifts !== undefined) patch.min_shifts = input.minShifts;
      if (input.maxShifts !== undefined) patch.max_shifts = input.maxShifts;
      if (input.doubleShift !== undefined) patch.double_shift = input.doubleShift;
      if (input.note !== undefined) patch.note = input.note;
      await db.update(SUBMISSIONS_TABLE, { id: submission.id }, patch);
      return { submissionId: submission.id, updatedAt: now };
    },

    async submitWeek(input, ctx) {
      // "Submit" / "Update": stamps submitted_at (and updated_at, the same
      // instant, so the submission reads as not-changed-since).
      const me = await myEmployeeRow(ctx);
      await assertOpen(input.weekStart, me.id, ctx);
      const submission = await ensureSubmission(input.weekStart, me.id, ctx);
      const now = new Date().toISOString();
      await db.update(SUBMISSIONS_TABLE, { id: submission.id }, { submitted_at: now, updated_at: now });
      return { submissionId: submission.id, submittedAt: now };
    },

    async weekOverview(input, ctx) {
      // The manager's table (stage 2, part 5). No admin check here: RLS decides
      // — an org admin reads every employee's private submission (the admin
      // branch of auth_user_can_read), anyone else only their own.
      const [week] = await db.select(WEEKS_TABLE, { org_id: ctx.orgId, week_start: input.weekStart });
      const submissions = (
        await db.select(SUBMISSIONS_TABLE, { org_id: ctx.orgId, week_start: input.weekStart })
      ).map(toSubmission);
      // Marks have no week column: one read per submission (bounded by the
      // number of employees), not one scan of every week's marks.
      const marks = (
        await Promise.all(
          submissions.map((sub) => db.select(MARKS_TABLE, { submission_id: sub.id })),
        )
      ).flatMap((rows) => rows.map(toMark));
      return { week: week ? toWeek(week) : null, submissions, marks };
    },

    // --- positions ----------------------------------------------------------
    async listPositions(_input, ctx) {
      const rows = await db.select(POSITIONS_TABLE, { org_id: ctx.orgId });
      return rows.map(toPosition);
    },

    async createPosition(input, ctx) {
      const id = safeRandomUUID();
      await db.insert(POSITIONS_TABLE, {
        id,
        ...ownership(ctx, new Date().toISOString()),
        name: input.name,
        position: input.position,
      });
      return { id };
    },

    async renamePosition(input, _ctx) {
      await db.update(
        POSITIONS_TABLE,
        { id: input.id },
        { name: input.name, updated_at: new Date().toISOString() },
      );
      return { id: input.id };
    },

    async reorderPositions(input, _ctx) {
      // One server call; each row gets its index. Not atomic (CortexDb updates one
      // row at a time) — a partial order is simply rewritten by the next reorder.
      const now = new Date().toISOString();
      for (const [index, id] of input.ids.entries()) {
        await db.update(POSITIONS_TABLE, { id }, { position: index, updated_at: now });
      }
      return { count: input.ids.length };
    },

    async deletePosition(input, _ctx) {
      // Refused by the DB while a shift requirement still uses it (RESTRICT);
      // employee links cascade.
      await db.delete(POSITIONS_TABLE, { id: input.id });
      return { id: input.id };
    },

    // --- org members + employees in the tool --------------------------------
    async listOrgMembers(_input, ctx) {
      // Same call and same per-user RLS client as the staff tool — never service.
      const members = await getOrganizationMembers(await getRls(), ctx.orgId);
      return members.map((m) => ({
        userId: m.userId,
        email: m.email,
        displayName: m.displayName,
      }));
    },

    async listEmployees(_input, ctx) {
      const rows = await db.select(EMPLOYEES_TABLE, { org_id: ctx.orgId });
      return rows.map(toEmployee);
    },

    async addEmployees(input, ctx) {
      // One server call for "add everyone". Not atomic: each row on its own, a
      // failure is recorded and the rest continue. The DB refuses a user who is
      // not a member of this org (composite FK to memberships) or already in.
      const result: AddEmployeesResult = { created: [], failed: [] };
      for (const userId of input.userIds) {
        const id = safeRandomUUID();
        try {
          await db.insert(EMPLOYEES_TABLE, {
            id,
            ...ownership(ctx, new Date().toISOString()),
            user_id: userId,
          });
          result.created.push({ id, userId, accessLevel: "employee" });
        } catch {
          result.failed.push(userId);
        }
      }
      return result;
    },

    async setAccessLevel(input, _ctx) {
      await db.update(
        EMPLOYEES_TABLE,
        { id: input.id },
        { access_level: input.accessLevel, updated_at: new Date().toISOString() },
      );
      return { id: input.id };
    },

    async removeEmployee(input, _ctx) {
      // "Remove from the tool": deletes the row; its position links cascade.
      await db.delete(EMPLOYEES_TABLE, { id: input.id });
      return { id: input.id };
    },

    // --- employee ↔ position links ------------------------------------------
    async listEmployeePositions(_input, ctx) {
      const rows = await db.select(EMPLOYEE_POSITIONS_TABLE, { org_id: ctx.orgId });
      return rows.map(toEmployeePosition);
    },

    async listMyPositions(_input, ctx) {
      // The ACTING user's positions in the active org — what the profile screen
      // shows ("the tool manages, the profile shows"). Not in the tool, or in it
      // with no positions → []. In display order, ties by name.
      const [me] = await db.select(EMPLOYEES_TABLE, { org_id: ctx.orgId, user_id: ctx.userId });
      if (!me) return [];
      const links = await db.select(EMPLOYEE_POSITIONS_TABLE, {
        org_id: ctx.orgId,
        employee_id: String(me.id),
      });
      if (links.length === 0) return [];
      const mine = new Set(links.map((l) => String(l.position_id)));
      const rows = await db.select(POSITIONS_TABLE, { org_id: ctx.orgId });
      return rows
        .map(toPosition)
        .filter((p) => mine.has(p.id))
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    },

    async assignPosition(input, ctx) {
      const id = safeRandomUUID();
      await db.insert(EMPLOYEE_POSITIONS_TABLE, {
        id,
        ...ownership(ctx, new Date().toISOString()),
        employee_id: input.employeeId,
        position_id: input.positionId,
      });
      return { id };
    },

    async unassignPosition(input, _ctx) {
      await db.delete(EMPLOYEE_POSITIONS_TABLE, { id: input.id });
      return { id: input.id };
    },

    // --- weekly shift templates ---------------------------------------------
    async listTemplates(_input, ctx) {
      const rows = await db.select(TEMPLATES_TABLE, { org_id: ctx.orgId });
      return rows.map(toTemplate);
    },

    async createTemplate(input, ctx) {
      const id = safeRandomUUID();
      await db.insert(TEMPLATES_TABLE, {
        id,
        ...ownership(ctx, new Date().toISOString()),
        weekday: input.weekday,
        name: input.name,
        start_time: input.startTime,
        end_time: input.endTime,
      });
      return { id };
    },

    async updateTemplate(input, _ctx) {
      await db.update(
        TEMPLATES_TABLE,
        { id: input.id },
        {
          name: input.name,
          start_time: input.startTime,
          end_time: input.endTime,
          updated_at: new Date().toISOString(),
        },
      );
      return { id: input.id };
    },

    async deleteTemplate(input, _ctx) {
      // Its requirements cascade (shift_requirements_template_fk).
      await db.delete(TEMPLATES_TABLE, { id: input.id });
      return { id: input.id };
    },

    async copyDayToAll(input, ctx) {
      // "Copy day X to all days" = REPLACE: every other day ends up with exactly
      // day X's shifts — names, hours AND requirements (how many of each
      // position). One server call.
      //
      // Order matters: the other days' shifts are DELETED FIRST (their
      // requirements cascade), then the copies are inserted — inserting first
      // would collide with same-named shifts on the unique (org, weekday, name).
      //
      // NOT ATOMIC (CortexDb writes one row at a time): a failure part-way leaves
      // some days copied and others not. It throws, so the caller reports the
      // failure, and running the copy again converges to the intended state.
      const templates = (await db.select(TEMPLATES_TABLE, { org_id: ctx.orgId })).map(toTemplate);
      const requirements = (await db.select(REQUIREMENTS_TABLE, { org_id: ctx.orgId })).map(
        toRequirement,
      );
      const source = templates.filter((t) => t.weekday === input.weekday);
      const others = templates.filter((t) => t.weekday !== input.weekday);

      const result: CopyDayResult = { deleted: 0, created: 0, requirementsCopied: 0 };

      for (const t of others) {
        await db.delete(TEMPLATES_TABLE, { id: t.id });
        result.deleted += 1;
      }

      for (let day = 0; day <= 6; day += 1) {
        if (day === input.weekday) continue;
        for (const t of source) {
          const id = safeRandomUUID();
          const now = new Date().toISOString();
          await db.insert(TEMPLATES_TABLE, {
            id,
            ...ownership(ctx, now),
            weekday: day,
            name: t.name,
            start_time: t.startTime,
            end_time: t.endTime,
          });
          result.created += 1;
          for (const r of requirements.filter((req) => req.templateId === t.id)) {
            await db.insert(REQUIREMENTS_TABLE, {
              id: safeRandomUUID(),
              ...ownership(ctx, now),
              template_id: id,
              position_id: r.positionId,
              required_count: r.requiredCount,
            });
            result.requirementsCopied += 1;
          }
        }
      }
      return result;
    },

    // --- staffing requirements ----------------------------------------------
    async listRequirements(_input, ctx) {
      const rows = await db.select(REQUIREMENTS_TABLE, { org_id: ctx.orgId });
      return rows.map(toRequirement);
    },

    async setRequirement(input, ctx) {
      // One call per (shift, position): 0 removes the row ("not needed" has no
      // row), any other count updates the existing row or creates it. The pair
      // is unique in the DB (shift_requirements_template_position_key).
      const [existing] = await db.select(REQUIREMENTS_TABLE, {
        template_id: input.templateId,
        position_id: input.positionId,
      });
      if (input.count === 0) {
        if (existing) await db.delete(REQUIREMENTS_TABLE, { id: String(existing.id) });
        return { id: null };
      }
      if (existing) {
        await db.update(
          REQUIREMENTS_TABLE,
          { id: String(existing.id) },
          { required_count: input.count, updated_at: new Date().toISOString() },
        );
        return { id: String(existing.id) };
      }
      const id = safeRandomUUID();
      await db.insert(REQUIREMENTS_TABLE, {
        id,
        ...ownership(ctx, new Date().toISOString()),
        template_id: input.templateId,
        position_id: input.positionId,
        required_count: input.count,
      });
      return { id };
    },
  };
}
