/**
 * Client-side mirror of `queryList`'s own urgent-first sort (`logic.ts`).
 *
 * Every write reconciles the SHARED react-query cache directly
 * (`setQueryData`) instead of refetching — a new task is appended at the
 * end, an edited task's `urgent` flips in place. The array's ORDER never
 * gets re-derived by those patches, so without this the on-screen order only
 * matches the server's urgent-first rule right after a fresh load (or a page
 * reload, which refetches) — not after any write. This does NOT replace
 * `queryList`'s sort — the server still decides the initial order and the
 * tie-break (`created_at`); this just re-applies the SAME primary key
 * whenever the views render, so a write never lets it drift.
 *
 * A single-key STABLE sort is enough: `Array.prototype.sort` is
 * specification-stable (ES2019+), so two tasks with equal `urgent` keep
 * their existing relative order — which is already correct, since it came
 * from `queryList`'s own sort (or an append/in-place patch that preserves
 * position). No need to re-compare `created_at` here.
 */
import type { Task } from "./logic";

export function sortTasksByUrgency(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => Number(b.urgent) - Number(a.urgent));
}
