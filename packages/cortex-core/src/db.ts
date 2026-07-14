/**
 * The database port used by the core (the data-layer's `ai_log` audit write and
 * the event-bus's `events` persistence).
 *
 * The core stays framework-agnostic — exactly like `@platform/db`'s factories —
 * by depending on this tiny interface rather than on `@supabase/*` directly. The
 * shell supplies a real adapter (a thin wrapper over the Supabase client running
 * as `service_role`, since shell writes bypass RLS); tests supply the in-memory
 * adapter below. This is the "provided db client" of Standard §7.
 */
export interface CortexDb {
  /**
   * Insert one row into a table. Implementations should apply DB-side defaults
   * (id, created_at) themselves — callers pass only the meaningful columns.
   */
  insert(table: string, row: Record<string, unknown>): Promise<void>;
}

/** An in-memory {@link CortexDb} that also lets tests read back what was written. */
export interface InMemoryDb extends CortexDb {
  /** All rows written to `table` (in insertion order). */
  rows(table: string): Array<Record<string, unknown>>;
  /** Number of rows written to `table`. */
  count(table: string): number;
}

/**
 * A dependency-free {@link CortexDb} that stores rows in a Map. Used by the
 * smoke test and any unit test that needs to assert "a row was written to
 * ai_log/events" without a live Postgres. It mimics the DB defaults a real
 * adapter would rely on (`id`, `created_at`).
 */
export function createInMemoryDb(): InMemoryDb {
  const store = new Map<string, Array<Record<string, unknown>>>();

  return {
    async insert(table, row) {
      const list = store.get(table) ?? [];
      list.push({
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        ...row,
      });
      store.set(table, list);
    },
    rows(table) {
      return store.get(table) ?? [];
    },
    count(table) {
      return store.get(table)?.length ?? 0;
    },
  };
}
