"use server";

import { requireSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createCortexAdminClient } from "@/lib/supabase/admin";

// SECURITY: identity ALWAYS comes from requireSession() (the session cookie),
// NEVER from the caller. Reads go through the RLS-scoped client; writes go through
// the service client (app_instances has no client write policy) but are always
// scoped to the session's userId + orgId — the service client bypasses RLS, so
// those .eq filters are what confine every write to the caller's own row.

/** The app keys the current user has installed IN THEIR ACTIVE ORG, install order. */
export async function listInstalledApps(): Promise<string[]> {
  const { userId, orgId } = await requireSession();
  const supabase = await createSupabaseServerClient();
  if (!supabase) return [];

  // 1) the user's instances in this org, earliest-installed first.
  const inst = await supabase
    .from("app_instances")
    .select("definition_id, created_at")
    .eq("owner_id", userId)
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  if (inst.error) throw new Error(`listInstalledApps (instances): ${inst.error.message}`);
  const rows = (inst.data ?? []) as Array<{ definition_id: string; created_at: string }>;
  if (rows.length === 0) return [];

  // 2) map definition_id -> key (app_definitions is readable by authenticated).
  const defIds = rows.map((r) => r.definition_id);
  const defs = await supabase.from("app_definitions").select("id, key").in("id", defIds);
  if (defs.error) throw new Error(`listInstalledApps (definitions): ${defs.error.message}`);
  const keyById = new Map(
    ((defs.data ?? []) as Array<{ id: string; key: string }>).map((d) => [d.id, d.key]),
  );
  // Preserve install order from step 1; drop any id with no matching definition.
  return rows.map((r) => keyById.get(r.definition_id)).filter((k): k is string => Boolean(k));
}

/** Install an app for the current user in their active org. Idempotent. */
export async function installApp(appKey: string): Promise<void> {
  const { userId, orgId } = await requireSession();
  const admin = createCortexAdminClient();

  const defRes = await admin
    .from("app_definitions")
    .select("id")
    .eq("key", appKey)
    .maybeSingle();
  if (defRes.error) throw new Error(`installApp (definition): ${defRes.error.message}`);
  if (!defRes.data) throw new Error(`installApp: unknown app "${appKey}"`);
  const definitionId = (defRes.data as { id: string }).id;

  // ON CONFLICT DO NOTHING against app_instances_owner_org_definition_unique.
  const ins = await admin.from("app_instances").upsert(
    { definition_id: definitionId, owner_type: "user", owner_id: userId, org_id: orgId },
    { onConflict: "owner_id,org_id,definition_id", ignoreDuplicates: true },
  );
  if (ins.error) throw new Error(`installApp (insert): ${ins.error.message}`);
}

/** Uninstall an app for the current user in their active org. No-op if absent. */
export async function uninstallApp(appKey: string): Promise<void> {
  const { userId, orgId } = await requireSession();
  const admin = createCortexAdminClient();

  const defRes = await admin
    .from("app_definitions")
    .select("id")
    .eq("key", appKey)
    .maybeSingle();
  if (defRes.error) throw new Error(`uninstallApp (definition): ${defRes.error.message}`);
  if (!defRes.data) return; // unknown app: nothing to remove
  const definitionId = (defRes.data as { id: string }).id;

  // Service bypasses RLS: the owner_id + org_id filters confine the delete to the
  // caller's own row. Never delete by a client-supplied owner.
  const del = await admin
    .from("app_instances")
    .delete()
    .eq("owner_id", userId)
    .eq("org_id", orgId)
    .eq("definition_id", definitionId);
  if (del.error) throw new Error(`uninstallApp (delete): ${del.error.message}`);
}
