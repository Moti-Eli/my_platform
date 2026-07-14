/**
 * The database port used by the core and by tool logic (the "provided db client"
 * of Standard §7).
 *
 * The core stays framework-agnostic — exactly like `@platform/db`'s factories —
 * by depending on this tiny interface rather than on `@supabase/*` directly. The
 * shell supplies a real adapter (a thin wrapper over the Supabase client running
 * as `service_role`, since shell writes bypass RLS); tests and the current
 * (pre-auth) tool runtime supply the in-memory adapter below.
 *
 * The core itself only ever `insert`s (ai_log + events). Tool logic additionally
 * reads and updates its own table via `select`/`update` — still going through
 * this one client, never raw SQL in a handler.
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
    rows(table) {
      return tableOf(table);
    },
    count(table) {
      return store.get(table)?.length ?? 0;
    },
  };
}
