/**
 * createShoppingListCore — create a list in its OWN root organization.
 *
 * FRAMEWORK-FREE ON PURPOSE, like candidates/invite-core.ts: no `next/*`, no
 * `"use server"`, no `"server-only"`. Both clients are injected, so a
 * verification harness can drive this exact function against a local stack.
 *
 * THE ORDER (ARCHITECTURE.md #36):
 *   (a) create a ROOT org for the caller with `createOrganizationForCurrentUser`
 *       — NOT a child org: a child org is read by its parent's members, so the
 *       owner's workplace would see their home list. The org's name is
 *       `<list name> · <6 random chars>`, to pass the per-user duplicate-name
 *       guard; the user sees the list name, never the org's.
 *   (b) INSTALL the shopping tool for the caller in that org (one app_instances
 *       row), so it appears and opens the moment they switch there.
 *   (c) insert the list through the RLS client, so the DB re-decides the write
 *       against the real actor (membership + owner_id = auth.uid()).
 * A failure at (b) or (c) compensates by deleting the org, which cascades its
 * roles, memberships, the install and any list row — nothing is left behind.
 */
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@platform/db";
import { createOrganizationForCurrentUser } from "@platform/auth";

export interface CreateShoppingListDeps {
  /** Actor-scoped (their JWT). The org's "logged in" gate and the list insert. */
  rlsDb: SupabaseClient;
  /** Service-role (bypasses RLS). Org provisioning, the install, compensation. */
  serviceDb: SupabaseClient;
}

export interface CreateShoppingListInput {
  /** The list name the user typed (already trimmed and length-checked). */
  name: string;
  /** The caller, from the session's ctx — never the client. */
  userId: string;
}

export type CreateShoppingListResult =
  | { listId: string; orgId: string }
  | { error: "createFailed" | "nameExists" | "notAllowed" | "invalidOrgName" };

const SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** 6 random lowercase letters/digits for the org name. */
function randomSuffix(): string {
  return Array.from(randomBytes(6), (b) => SUFFIX_ALPHABET[b % SUFFIX_ALPHABET.length]).join("");
}

export async function createShoppingListCore(
  { rlsDb, serviceDb }: CreateShoppingListDeps,
  { name, userId }: CreateShoppingListInput,
): Promise<CreateShoppingListResult> {
  // (a) The list's own root org.
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
  //     (20261023000001): a missing seed row is a configuration error — compensate.
  const defRes = await serviceDb.from("app_definitions").select("id").eq("key", "shopping").maybeSingle();
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

  // (c) The list itself, through the actor's RLS client.
  const listRes = await rlsDb
    .from("shopping_lists")
    .insert({ owner_id: userId, org_id: orgId, name })
    .select("id")
    .single();
  const listId = (listRes.data as { id: string } | null)?.id;
  if (listRes.error || !listId) {
    await compensate();
    return { error: "createFailed" };
  }

  return { listId, orgId };
}
