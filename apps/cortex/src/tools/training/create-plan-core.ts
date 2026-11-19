/**
 * createTrainingPlanCore — create a plan in its OWN root organization.
 *
 * FRAMEWORK-FREE ON PURPOSE, like shopping/create-list-core.ts: no `next/*`, no
 * `"use server"`, no `"server-only"`. Both clients are injected, so a
 * verification harness can drive this exact function against a local stack.
 *
 * THE ORDER (ARCHITECTURE.md #38, same as shopping):
 *   (a) create a ROOT org for the caller with `createOrganizationForCurrentUser`
 *       — NOT a child org: a child org is read by its parent's members, so the
 *       owner's workplace would see their workout plan. The org's name is
 *       `<plan name> · <6 random chars>`, to pass the per-user duplicate-name
 *       guard; the user sees the plan name, never the org's.
 *   (b) INSTALL the training tool for the caller in that org (one
 *       app_instances row), so it appears and opens the moment they switch there.
 *   (c) insert the plan through the RLS client, so the DB re-decides the write
 *       against the real actor (membership + owner_id = auth.uid()).
 * A failure at (b) or (c) compensates by deleting the org, which cascades its
 * roles, memberships, the install and any plan row — nothing is left behind.
 */
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@platform/db";
import { createOrganizationForCurrentUser } from "@platform/auth";

export interface CreateTrainingPlanDeps {
  /** Actor-scoped (their JWT). The org's "logged in" gate and the plan insert. */
  rlsDb: SupabaseClient;
  /** Service-role (bypasses RLS). Org provisioning, the install, compensation. */
  serviceDb: SupabaseClient;
}

export interface CreateTrainingPlanInput {
  /** What the user typed (already trimmed and length-checked). */
  name: string;
  description: string;
  frequencyPerWeek: number | null;
  /** The caller, from the session's ctx — never the client. */
  userId: string;
}

export type CreateTrainingPlanResult =
  | { planId: string; orgId: string }
  | { error: "createFailed" | "nameExists" | "notAllowed" | "invalidOrgName" };

const SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** 6 random lowercase letters/digits for the org name. */
function randomSuffix(): string {
  return Array.from(randomBytes(6), (b) => SUFFIX_ALPHABET[b % SUFFIX_ALPHABET.length]).join("");
}

export async function createTrainingPlanCore(
  { rlsDb, serviceDb }: CreateTrainingPlanDeps,
  { name, description, frequencyPerWeek, userId }: CreateTrainingPlanInput,
): Promise<CreateTrainingPlanResult> {
  // (a) The plan's own root org.
  const org = await createOrganizationForCurrentUser(rlsDb, serviceDb, {
    organizationName: `${name} · ${randomSuffix()}`,
  });
  if (org.error || !org.organizationId) {
    const known = ["nameExists", "notAllowed", "invalidOrgName"] as const;
    const key = known.find((k) => k === org.error);
    return { error: key ?? "createFailed" };
  }
  const orgId = org.organizationId;

  const compensate = async (): Promise<void> => {
    await serviceDb.from("organizations").delete().eq("id", orgId);
  };

  // (b) Install the tool in the new org. Resolve the definition by its SEEDED key
  //     (20261028000004): a missing seed row is a configuration error — compensate.
  const defRes = await serviceDb
    .from("app_definitions")
    .select("id")
    .eq("key", "training")
    .maybeSingle();
  const definitionId = (defRes.data as { id: string } | null)?.id;
  if (defRes.error || !definitionId) {
    await compensate();
    return { error: "createFailed" };
  }
  const instRes = await serviceDb.from("app_instances").insert({
    definition_id: definitionId,
    owner_id: userId,
    org_id: orgId,
  });
  if (instRes.error) {
    await compensate();
    return { error: "createFailed" };
  }

  // (c) The plan itself, through the actor's RLS client.
  const planRes = await rlsDb
    .from("workout_plans")
    .insert({
      owner_id: userId,
      org_id: orgId,
      name,
      description,
      frequency_per_week: frequencyPerWeek,
    })
    .select("id")
    .single();
  const planId = (planRes.data as { id: string } | null)?.id;
  if (planRes.error || !planId) {
    await compensate();
    return { error: "createFailed" };
  }

  return { planId, orgId };
}
