/**
 * The database port used by the core and by tool logic (the "provided db client"
 * of Standard §7).
 *
 * The core stays framework-agnostic — exactly like `@platform/db`'s factories —
 * by depending on this tiny interface rather than on `@supabase/*` directly.
 * Tests and headless runs use the in-memory adapter below; the real app supplies
 * a Supabase-backed adapter (`apps/cortex/src/cortex/supabase-db.ts`, server-only).
 *
 * ============================================================================
 * HOW THE REAL ADAPTER ROUTES — and why it is NOT a single service_role client
 * ============================================================================
 * An earlier version of this header said the shell supplies "a thin wrapper over
 * the Supabase client running as service_role, since shell writes bypass RLS."
 * That was written before the row-level access model existed, and it is now
 * WRONG in two load-bearing ways — do not restore it:
 *
 *   1. service_role BYPASSES RLS. `inventory_items`' SELECT policy is where
 *      `private.auth_user_can_read` runs (20260716000005). Read it through
 *      service_role and that policy never executes — the ENTIRE row-level access
 *      model (org / private / restricted, grants, the downward-only tree) becomes
 *      decoration. READS MUST carry the user's JWT so RLS is the enforcement point.
 *
 *   2. The composition root that builds intents also runs CLIENT-side
 *      (`runtime.ts`, for the chips/catalog). A service_role client constructed
 *      there ships the secret (RLS-bypassing) key into every browser bundle.
 *
 * THE REAL RULE:
 *   - READS (inventory_items, and any future tool table) go through an
 *     RLS-scoped client carrying the user's JWT, because `auth_user_can_read` /
 *     `can_write` IS the enforcement point and service_role would erase it.
 *   - Only the shell's OWN audit writes — `ai_log` and `events` — use
 *     service_role, and only on the server. `authenticated` holds NO insert on
 *     those tables (20260717000001 / 20260717000002) and MUST NOT: the subject of
 *     an audit does not get to write it. A user who authors their own audit trail
 *     is not being audited.
 *
 * `insert/select/update` stay a tiny generic surface; the adapter decides which
 * client each table gets. The interface below is unchanged — only this note is.
 */
import { safeRandomUUID } from "./id";

export type DbRow = Record<string, unknown>;
/** A shallow equality match (every key must equal the row's value). */
export type DbMatch = Record<string, unknown>;

export interface CortexDb {
  /**
   * Insert one row into a table. Implementations apply DB-side defaults (id,
   * created_at) when absent — callers pass only the meaningful columns.
   */
  insert(table: string, row: DbRow): Promise<void>;
  /** Return the rows in `table` matching every key/value in `match` (all if omitted). */
  select(table: string, match?: DbMatch): Promise<DbRow[]>;
  /** Apply `patch` to every row matching `match`; returns the updated rows. */
  update(table: string, match: DbMatch, patch: DbRow): Promise<DbRow[]>;
  /** Delete every row matching `match`. Like `update`, it is RLS-gated by the
   * adapter's client choice — never service_role for a tool table. */
  delete(table: string, match: DbMatch): Promise<void>;
}

/** An in-memory {@link CortexDb} that also lets tests read back what was written. */
export interface InMemoryDb extends CortexDb {
  /** All rows written to `table` (in insertion order). */
  rows(table: string): DbRow[];
  /** Number of rows written to `table`. */
  count(table: string): number;
}

function matches(row: DbRow, match: DbMatch): boolean {
  return Object.entries(match).every(([key, value]) => row[key] === value);
}

/**
 * A dependency-free {@link CortexDb} that stores rows in a Map. Used by the smoke
 * tests and the current tool runtime (until Supabase + auth are wired). It mimics
 * the DB defaults a real adapter would rely on (`id`, `created_at`).
 */
export function createInMemoryDb(): InMemoryDb {
  const store = new Map<string, DbRow[]>();
  const tableOf = (table: string): DbRow[] => {
    const list = store.get(table) ?? [];
    store.set(table, list);
    return list;
  };

  return {
    async insert(table, row) {
      tableOf(table).push({
        id: safeRandomUUID(),
        created_at: new Date().toISOString(),
        ...row,
      });
    },
    async select(table, match) {
      const rows = tableOf(table).filter((row) => (match ? matches(row, match) : true));
      // Return copies so callers can't mutate the store directly.
      return rows.map((row) => ({ ...row }));
    },
    async update(table, match, patch) {
      const updated: DbRow[] = [];
      for (const row of tableOf(table)) {
        if (matches(row, match)) {
          Object.assign(row, patch);
          updated.push({ ...row });
        }
      }
      return updated;
    },
    async delete(table, match) {
      store.set(
        table,
        tableOf(table).filter((row) => !matches(row, match)),
      );
    },
    rows(table) {
      return tableOf(table);
    },
    count(table) {
      return store.get(table)?.length ?? 0;
    },
  };
}
