// SERVER-ONLY. This adapter holds the service (secret-key) client and must never
// reach a browser bundle. `server-only` makes importing it from a Client
// Component a build error.
import "server-only";

import type { SupabaseClient } from "@platform/db";
import type { CortexDb, DbRow } from "@platform/cortex-core";

/**
 * A Supabase-backed {@link CortexDb} — the real data path for Cortex tool
 * intents. READS-ONLY for tool tables this step; the `insert`/`update` paths on
 * tool tables will be denied by grants until the write step lands (that is
 * correct and expected — see the views' degrade handling).
 *
 * ── TABLE ROUTING ─────────────────────────────────────────────────────────
 * The whole point of this adapter is choosing WHICH client each table gets:
 *
 *   ai_log, events  -> SERVICE (secret key). These are the shell's own audit
 *                      writes. `authenticated` holds no INSERT on them
 *                      (20260717000001 / 20260717000002) and must not — the
 *                      subject of an audit does not write it.
 *   everything else -> RLS (the user's JWT). `inventory_items`' SELECT policy is
 *                      where `private.auth_user_can_read` runs; reading it through
 *                      service_role would bypass RLS and erase the entire access
 *                      model. So it MUST carry the user's identity.
 *
 * THE DEFAULT IS RLS, DELIBERATELY. `AUDIT_TABLES` is a closed allowlist; a table
 * not in it falls to the enforced side. If someone adds a tool table later and
 * forgets to classify it, it KEEPS enforcement (fails safe) — it can never
 * silently fall through to service_role and bypass RLS (fails open). The unsafe
 * option is the one you have to opt into by name, never the default.
 *
 * ── WHY `rls` IS A FACTORY, NOT A FIXED CLIENT ────────────────────────────
 * The task framed this adapter as taking "two clients". `service` genuinely is a
 * client: it carries no session, so one instance is safe to share across every
 * request. `rls` is NOT — it carries a specific user's JWT. This adapter is baked
 * (via the tool logic → intents → registry) into PROCESS-GLOBAL state that
 * outlives a single request, so a fixed rls instance would serve the first
 * caller's identity to the next caller. Resolving it per operation, from the
 * current request's cookies, is what keeps each read scoped to the right user.
 * See server-runtime.ts for the whole reasoning.
 *
 * ── ON ERROR, THROW ───────────────────────────────────────────────────────
 * Never return an empty array on error. A permission denial that looks like "no
 * rows" is the exact trap this project has hit before — a blocked read and an
 * empty inventory must never be indistinguishable. Every failure throws with the
 * table and the underlying message (server-side; the action maps it to a stable
 * code before anything reaches the client).
 */
export interface SupabaseCortexDbDeps {
  /**
   * Resolve the RLS-scoped client for the CURRENT request (user's JWT from
   * cookies). A function, not an instance — see the header.
   */
  getRls: () => Promise<SupabaseClient>;
  /** The service (secret-key) client. Stateless; one instance is fine. */
  service: SupabaseClient;
}

/** Tables that are the shell's own audit trail — the ONLY tables routed to service. */
const AUDIT_TABLES = new Set(["ai_log", "events"]);

export function createSupabaseCortexDb({ getRls, service }: SupabaseCortexDbDeps): CortexDb {
  // The one routing decision. Default (not an audit table) -> the RLS client, so
  // enforcement runs. Never the reverse.
  async function clientFor(table: string): Promise<SupabaseClient> {
    return AUDIT_TABLES.has(table) ? service : await getRls();
  }

  function fail(op: string, table: string, message: string): never {
    throw new Error(`CortexDb.${op}(${table}): ${message}`);
  }

  return {
    async insert(table, row) {
      const client = await clientFor(table);
      const { error } = await client.from(table).insert(row);
      if (error) fail("insert", table, error.message);
    },

    async select(table, match) {
      const client = await clientFor(table);
      let query = client.from(table).select("*");
      // `match` becomes chained .eq() calls — every key must equal the row's value.
      for (const [column, value] of Object.entries(match ?? {})) {
        query = query.eq(column, value);
      }
      const { data, error } = await query;
      if (error) fail("select", table, error.message);
      return (data ?? []) as DbRow[];
    },

    async update(table, match, patch) {
      const client = await clientFor(table);
      let query = client.from(table).update(patch);
      for (const [column, value] of Object.entries(match)) {
        query = query.eq(column, value);
      }
      const { data, error } = await query.select();
      if (error) fail("update", table, error.message);
      return (data ?? []) as DbRow[];
    },
  };
}
