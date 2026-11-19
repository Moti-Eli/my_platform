/**
 * Training — internal business logic (Standard §2 `logic.ts`).
 *
 * Stage 1, part A: the plan itself. Reading the active org's plan, listing
 * every plan the user is in ("My plans"), and creating a plan — which also
 * creates the plan's own root organization and installs the tool there (see
 * create-plan-core.ts). That write needs the service client, so it is INJECTED
 * — the server passes the real implementation, the client a throwing stub (same
 * seam as shopping.create_list).
 *
 * SCOPED BY `org_id`: every plan lives in its own org, so the active org holds
 * at most one plan (`workout_plans_org_id_key`). The filter is a CONTEXT filter,
 * not a security one — RLS is the enforcement point.
 */
import { getUserOrganizations } from "@platform/auth";
import type { SupabaseClient } from "@platform/db";
import type { Ctx, CortexDb, DbRow } from "@platform/cortex-core";

export const PLANS_TABLE = "workout_plans";

/** Mirrors workout_plans.name CHECK (1–100). */
export const PLAN_NAME_MAX = 100;
/** Mirrors workout_plans.description CHECK (<= 1000; '' = none). */
export const PLAN_DESCRIPTION_MAX = 1000;
/** Mirrors workout_plans.frequency_per_week CHECK (1–7; NULL = not set). */
export const FREQUENCY_MIN = 1;
export const FREQUENCY_MAX = 7;

export interface Plan {
  id: string;
  /** The plan's own org — "open" a plan = switch to this org. */
  orgId: string;
  name: string;
  /** '' = none. */
  description: string;
  /** Workouts per week (1–7), or null when not set. */
  frequencyPerWeek: number | null;
  createdAt: string;
}

export interface CreatePlanInput {
  name: string;
  description: string;
  frequencyPerWeek: number | null;
}

/** The new plan and the org it lives in — the caller switches to `orgId`. */
export interface CreatePlanResult {
  planId: string;
  orgId: string;
}

export interface TrainingLogic {
  /** The active org's plan, or null when the active org is not a plan org. */
  getPlan(input: Record<string, never>, ctx: Ctx): Promise<Plan | null>;
  /** Every plan in an org the user is an active member of, newest first. */
  listPlans(input: Record<string, never>, ctx: Ctx): Promise<Plan[]>;
  createPlan(input: CreatePlanInput, ctx: Ctx): Promise<CreatePlanResult>;
}

type Emit = (type: string, payload: unknown, ctx: Ctx) => Promise<void>;

function toPlan(row: DbRow): Plan {
  const freq = row.frequency_per_week;
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    name: String(row.name),
    description: String(row.description ?? ""),
    frequencyPerWeek: typeof freq === "number" ? freq : freq == null ? null : Number(freq),
    createdAt: String(row.created_at),
  };
}

export function createTrainingLogic({
  db,
  emit: _emit,
  getRls,
  createPlan,
}: {
  db: CortexDb;
  emit: Emit;
  /** The per-user RLS client (server); a throwing stub on the client. */
  getRls: () => Promise<SupabaseClient>;
  /** INJECTED — the server passes the real implementation; the client passes a
   *  throwing stub (createPlan never runs client-side). */
  createPlan: (input: CreatePlanInput, ctx: Ctx) => Promise<CreatePlanResult>;
}): TrainingLogic {
  return {
    async getPlan(_input, ctx) {
      const rows = await db.select(PLANS_TABLE, { org_id: ctx.orgId });
      const first = rows[0];
      return first ? toPlan(first) : null;
    },

    async listPlans(_input, ctx) {
      // No org filter: RLS returns only plans in orgs the user may read. The
      // membership list (also through RLS, deleted_at-aware) then drops plans
      // whose org the user has hidden — the same list the org switcher shows.
      const [rows, orgs] = await Promise.all([
        db.select(PLANS_TABLE, {}),
        getRls().then((rls) => getUserOrganizations(rls, ctx.userId)),
      ]);
      const active = new Set(orgs.map((o) => o.organizationId));
      return rows
        .map(toPlan)
        .filter((p) => active.has(p.orgId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    createPlan,
  };
}
