/**
 * Shifts — internal business logic (Standard §2 `logic.ts`).
 *
 * The ONLY place shifts touches its data. Tool tables go through the provided
 * `CortexDb` (never raw SQL); it receives `ctx` from the shell and never fetches
 * identity itself.
 *
 * Stage 1 so far: POSITIONS (part 1), EMPLOYEES in the tool + which positions
 * each can fill (part 2), and the WEEKLY SHIFT TEMPLATES (part 3) — including
 * "copy a day to all days", which already copies requirements too. Editing
 * requirements themselves is part 4.
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

export const POSITIONS_TABLE = "shift_positions";
export const EMPLOYEES_TABLE = "shift_employees";
export const EMPLOYEE_POSITIONS_TABLE = "shift_employee_positions";
export const TEMPLATES_TABLE = "shift_templates";
export const REQUIREMENTS_TABLE = "shift_requirements";

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
}

/** How many people of one position a shift needs (a shift_requirements row). */
export interface ShiftRequirement {
  id: string;
  templateId: string;
  positionId: string;
  requiredCount: number;
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
  assignPosition(input: AssignPositionInput, ctx: Ctx): Promise<{ id: string }>;
  unassignPosition(input: IdInput, ctx: Ctx): Promise<{ id: string }>;

  listTemplates(input: ListInput, ctx: Ctx): Promise<ShiftTemplate[]>;
  createTemplate(input: CreateTemplateInput, ctx: Ctx): Promise<{ id: string }>;
  updateTemplate(input: UpdateTemplateInput, ctx: Ctx): Promise<{ id: string }>;
  deleteTemplate(input: IdInput, ctx: Ctx): Promise<{ id: string }>;
  copyDayToAll(input: CopyDayInput, ctx: Ctx): Promise<CopyDayResult>;
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
  return {
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
  };
}
