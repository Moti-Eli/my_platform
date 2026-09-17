"use client";

/**
 * Tasks full screen (Standard §2 `views/FullScreen.tsx`, §8). Cloned from
 * Inventory's full screen, on the app-violet (indigo) identity accent.
 *
 * Task list with a per-row done toggle and an add-task action. The read is the
 * SHARED react-query cache (`useTasksList`, queryKey ["tasks","list"]) — the same
 * entry the dashboard card reads — so this screen renders from cache and each write
 * reconciles that cache via setQueryData (no refetch). Writes go straight through
 * the SERVER action (`runIntentAction`); every call — read or write — builds ctx
 * from the session, so no identity is sent from here.
 *
 * WRITES WORK (20260717000006 opened the path, mirroring inventory_items). A write
 * flows runIntentAction -> the server data-layer -> the RLS client, gated ROW BY ROW
 * by `private.auth_user_can_write`: membership in the row's org tree is the gate. A
 * write can genuinely succeed — so this screen toggles OPTIMISTICALLY and reconciles
 * to the server's authoritative answer — or genuinely fail, in which case the failure
 * is surfaced honestly, never faked and never swallowed.
 *
 * Built from design-system utilities + i18n only.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { runIntentAction, type IntentResult } from "@/cortex/actions";
import type { ToolViewProps } from "@/tools";
import { useI18n, type MessageKey } from "@/i18n";
import {
  ChevronIcon,
  CheckIcon,
  CloseIcon,
  InfoIcon,
  MenuIcon,
  ComposeIcon,
} from "@/components/icons";
import type { Task, TaskScheduling } from "../logic";
import { useTasksList, TASKS_LIST_KEY } from "@/lib/query/useTasksList";
import {
  todayDateValue,
  isoToDateAndTime,
  dateAndTimeToIso,
  formatDueDate,
  startOfWeek,
  addDays,
  isSameLocalDay,
  formatWeekday,
  formatWeekRangeLabel,
} from "../dateFormat";
import { CATEGORIES, categoryOf } from "../categories";
import { sortTasksByUrgency } from "../sortTasks";

/** The failure codes a write can come back with (from {@link IntentResult}). */
type WriteErrorCode = Extract<IntentResult, { ok: false }>["code"];

/** Which subset of tasks the floating filter bar shows. Client-side only — it
 * never re-queries; it filters the same list already in the shared cache.
 * "general" is scheduling-based (scheduling === "general"), a DIFFERENT axis
 * from "open"/"done" (completion) — both live in the same single-select
 * control by explicit design, not because they're the same kind of thing. */
type TaskFilter = "all" | "open" | "done" | "general";

/** HOW the (already-filtered) tasks are displayed — a second, independent axis
 * from {@link TaskFilter}: filter decides WHICH tasks, view decides how they're
 * laid out. "list" is the existing rows; "week" buckets by due-date into 7
 * day columns (tasks with no due date never appear there). */
type TaskView = "list" | "week";

// userId/orgId arrive as props (the page called requireSession()) but are NOT
// sent to the action — the server derives identity from the session cookie. They
// stay in the prop type only because the page provides them; `_props` marks them
// deliberately unused.
export function FullScreen(_props: ToolViewProps) {
  const { t, dir, locale } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  // The READ: straight from the shared query cache — this screen is a reader of the
  // SAME entry the dashboard card reads. It renders from the cache (the single
  // source of truth) and writes back into it via setQueryData, so the two views can
  // never hold diverging copies. Arriving from the card, the cache is warm and the
  // list paints instantly; react-query revalidates in the background.
  const { tasks } = useTasksList();
  const [adding, setAdding] = useState(false);
  // The floating filter bar's current selection — filters the SAME shared list,
  // no refetch.
  const [filter, setFilter] = useState<TaskFilter>("all");
  // Which layout shows the (already-filtered) tasks — independent of `filter`
  // (see TaskView). Toggled from the filter bar's hamburger menu.
  const [view, setView] = useState<TaskView>("list");
  // The Sunday that anchors the week view's 7 columns. Lazy initializer so
  // `startOfWeek(new Date())` runs once, not on every render.
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  // Set when a write actually FAILS. Distinguishes the honest cases: "denied" /
  // "unavailable" (the DB refused — you may not) vs "failed" (something broke).
  // Never a silent no-op, and never a pretend-success.
  const [writeError, setWriteError] = useState<WriteErrorCode | null>(null);
  // Guards the async setState in the WRITE callbacks below: they resolve after an
  // await, so a navigation away before they settle must not set component state on
  // an unmounted component. (Cache writes via queryClient are safe either way — and
  // are intentionally NOT gated on this, so a write still reconciles the shared
  // cache even if this screen has since unmounted.)
  const mounted = useRef(true);
  useEffect(() => {
    // Re-arm on every (re)mount. Under StrictMode React runs mount → cleanup →
    // mount; setting `true` here (not only `false` in cleanup) means the second
    // mount re-enables the guard instead of leaving it permanently disarmed,
    // which would swallow every later setState and strand the view empty.
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // In-flight toggles, keyed by task id. A second toggle for a task whose write is
  // still running is ignored (and that row's checkbox is disabled), so a double-tap
  // can't double-apply. This is PER-TASK, not a global lock — clicks on other rows
  // stay fully responsive. The ref is the synchronous source of truth for the guard
  // (reading `pending` state would be stale within a burst of taps, before a
  // re-render lands); `pending` mirrors it only to disable checkboxes.
  const pendingRef = useRef<Set<string>>(new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(pendingRef.current);

  // In-flight DELETES, keyed by task id — a SEPARATE guard from the toggle set
  // above, so a toggle and a delete never share a lock. Same shape as `pending`.
  const deletingRef = useRef<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<ReadonlySet<string>>(deletingRef.current);
  // Which row is mid two-tap delete confirm (null = none). Tapping a different row's
  // trash moves the confirm there; a second tap on the SAME row commits the delete.
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // Which row is mid inline edit (null = none). Tapping a different row's edit
  // button moves editing there; the previous row's unsaved edits are discarded.
  const [editingId, setEditingId] = useState<string | null>(null);

  // Patch one row in the shared cache by id. Functional updater, so concurrent
  // in-flight writes compose instead of clobbering. `prev ?? []` because the cache
  // can momentarily be undefined (a write racing ahead of the first read).
  const patchTask = useCallback(
    (id: string, patch: (it: Task) => Task) => {
      queryClient.setQueryData<Task[]>(TASKS_LIST_KEY, (prev) =>
        (prev ?? []).map((it) => (it.id === id ? patch(it) : it)),
      );
    },
    [queryClient],
  );

  const toggleTask = useCallback(
    async (id: string, done: boolean) => {
      // 0. GUARD double-submit: ignore a toggle for a task whose write is still in
      //    flight. The ref check is synchronous, so it also catches a second tap in
      //    the micro-window before the disabled checkbox re-renders.
      if (pendingRef.current.has(id)) return;
      const nextPending = new Set(pendingRef.current).add(id);
      pendingRef.current = nextPending;
      setPending(nextPending);

      // 1. OPTIMISTIC: set the new done state straight into the SHARED cache, before
      //    awaiting, so the tap has instant feedback AND the dashboard card (reading
      //    the same cache) moves in lockstep.
      setWriteError(null);
      patchTask(id, (it) => ({ ...it, done }));

      try {
        const res = await runIntentAction("tasks.toggle_task", { id, done });

        if (res.ok) {
          // 2. Reconcile the cache to the server's AUTHORITATIVE done state. No
          //    refetch — the server already told us the answer. Deliberately runs
          //    even if we've since unmounted: the cache is shared, so this keeps the
          //    dashboard card correct.
          const { id: rid, done: rdone } = res.data as { id: string; done: boolean };
          patchTask(rid, (it) => ({ ...it, done: rdone }));
        } else {
          // 3. REVERT this toggle in the cache (back to the prior value, `!done`) and
          //    surface the real error. The cache is written only on these chosen
          //    paths, so a failure leaves it consistent — never corrupted.
          patchTask(id, (it) => ({ ...it, done: !done }));
          if (mounted.current) setWriteError(res.code);
        }
      } finally {
        // Clear the in-flight mark whether the write succeeded, failed, or threw —
        // the row's checkbox re-enables and the ref never leaks a stuck task.
        const cleared = new Set(pendingRef.current);
        cleared.delete(id);
        pendingRef.current = cleared;
        if (mounted.current) setPending(cleared);
      }
    },
    [patchTask],
  );

  const updateTask = useCallback(
    async (
      id: string,
      title: string,
      dueDate: string | null,
      category: string | null,
      urgent: boolean,
      scheduling: TaskScheduling,
    ) => {
      // Snapshot the row BEFORE the optimistic patch, so a failure can restore
      // its exact prior title/dueDate/category/urgent/scheduling — same shape
      // as removeTask's snapshot.
      const prevList = queryClient.getQueryData<Task[]>(TASKS_LIST_KEY) ?? [];
      const original = prevList.find((it) => it.id === id) ?? null;

      // A general task cannot hold a due date — the SAME rule logic.ts
      // enforces server-side, mirrored here so the optimistic cache write
      // never shows a stale date next to "general".
      const effectiveDue = scheduling === "general" ? null : dueDate;

      // 1. OPTIMISTIC: same pattern as toggleTask — write the new values into the
      //    SHARED cache before awaiting, so the row and the dashboard card update
      //    in lockstep.
      setWriteError(null);
      patchTask(id, (it) => ({
        ...it,
        title,
        dueDate: effectiveDue,
        category,
        urgent,
        scheduling,
      }));

      const res = await runIntentAction("tasks.update_task", {
        id,
        title,
        dueDate: effectiveDue,
        category,
        urgent,
        scheduling,
      });

      if (res.ok) {
        // 2. Success closes the inline form — nothing left to reconcile, the
        //    server accepted exactly what we already wrote.
        if (mounted.current) setEditingId(null);
      } else {
        // 3. REVERT to the original title/dueDate and surface the error. Editing
        //    stays open (unlike a failed toggle, the user's typed input is still
        //    worth keeping so they can retry, not just their prior click).
        if (original) patchTask(id, () => original);
        if (mounted.current) setWriteError(res.code);
      }
    },
    [patchTask, queryClient],
  );

  const removeTask = useCallback(
    async (id: string) => {
      // 0. GUARD double-delete (mirrors toggleTask's in-flight guard): ignore a
      //    delete for a task whose delete is already running.
      if (deletingRef.current.has(id)) return;

      // Snapshot the row AND its index from the cache BEFORE removing, so a failure
      // can restore it exactly where it was.
      const prevList = queryClient.getQueryData<Task[]>(TASKS_LIST_KEY) ?? [];
      const index = prevList.findIndex((it) => it.id === id);
      const removed = index >= 0 ? prevList[index] : null;

      const nextDeleting = new Set(deletingRef.current).add(id);
      deletingRef.current = nextDeleting;
      setDeleting(nextDeleting);

      // 1. OPTIMISTIC: drop the row from the SHARED cache immediately, so the
      //    dashboard card (reading the same cache) drops it in lockstep.
      setWriteError(null);
      queryClient.setQueryData<Task[]>(TASKS_LIST_KEY, (prev) =>
        (prev ?? []).filter((it) => it.id !== id),
      );

      try {
        const res = await runIntentAction("tasks.delete_task", { id });
        // 2. On success: leave it removed — nothing to reconcile.
        if (!res.ok) {
          // 3. REVERT: re-insert the removed row at its original position and
          //    surface the error via the existing writeError alert. The cache is
          //    written only on these chosen paths, so a failure leaves it consistent.
          if (removed) {
            queryClient.setQueryData<Task[]>(TASKS_LIST_KEY, (prev) => {
              const list = [...(prev ?? [])];
              list.splice(Math.min(index, list.length), 0, removed);
              return list;
            });
          }
          if (mounted.current) setWriteError(res.code);
        }
      } finally {
        const cleared = new Set(deletingRef.current);
        cleared.delete(id);
        deletingRef.current = cleared;
        if (mounted.current) setDeleting(cleared);
      }
    },
    [queryClient],
  );

  // Applied client-side against the same shared list — a display filter, not a
  // different read. "open" mirrors the DashboardCard's own not-done definition.
  // Re-sorted urgent-first AFTER filtering (see sortTasks.ts) — writes patch
  // the cache in place without re-sorting it, so this is what keeps urgent
  // tasks on top after an add/edit, not just after a fresh load. Feeds BOTH
  // the list render below AND WeekView (its per-day bucketing preserves this
  // relative order).
  const filteredTasks = sortTasksByUrgency(
    tasks.filter((task) => {
      if (filter === "open") return !task.done;
      if (filter === "done") return task.done;
      if (filter === "general") return task.scheduling === "general";
      return true;
    }),
  );

  // "Nothing at all" and "nothing in THIS filter" are different situations and
  // must not share a message: with a filter on, the list can be empty while the
  // org has plenty of tasks. Distinguishing them is the difference between an
  // honest empty state and a lie.
  const filterHidesEverything = tasks.length > 0 && filteredTasks.length === 0;

  // Scheduled/general split — ONLY rendered when filter === "all" (see below).
  // Filtering an already urgent-first-sorted array preserves that relative
  // order within each resulting subset, so no re-sort is needed here: the
  // urgency ordering stays intact WITHIN each group for free.
  const scheduledGroup = filteredTasks.filter((task) => task.scheduling === "scheduled");
  const generalGroup = filteredTasks.filter((task) => task.scheduling === "general");

  // One row's markup, shared by the flat list AND the two "all"-filter groups
  // below — extracted so the two render paths can never drift apart. Nothing
  // about the row itself changed; only WHERE it's called from did.
  function renderTaskRow(task: Task) {
    // This row has a toggle or a delete in flight — disable its controls so a
    // second tap can't double-apply. Other rows are unaffected.
    const rowPending = pending.has(task.id);
    const rowDeleting = deleting.has(task.id);
    const confirming = confirmId === task.id;
    const editing = editingId === task.id;
    const cat = categoryOf(task.category);
    return (
      <li key={task.id} className="flex items-center gap-sm py-sm">
        {editing ? (
          <EditTaskForm
            task={task}
            onSave={(title, dueDate, category, urgent, scheduling) =>
              updateTask(task.id, title, dueDate, category, urgent, scheduling)
            }
            onCancel={() => setEditingId(null)}
          />
        ) : (
          <>
            <button
              type="button"
              aria-label={task.done ? t("tasks.markUndone") : t("tasks.markDone")}
              aria-pressed={task.done}
              onClick={() => toggleTask(task.id, !task.done)}
              disabled={rowPending || rowDeleting}
              className="flex min-w-0 flex-1 items-center gap-sm text-start interactive motion-safe:active:scale-[0.99]"
            >
              {/* Done/undone visual: a violet check circle when done, a muted
                  empty circle otherwise. */}
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                  task.done ? "bg-app-violet text-on-fill" : "bg-hairline text-muted"
                }`}
              >
                {task.done ? <CheckIcon width={16} height={16} /> : null}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="flex min-w-0 items-center gap-2xs">
                  <span
                    className={`min-w-0 flex-1 truncate type-heading ${
                      task.done ? "text-muted line-through" : "text-ink"
                    }`}
                  >
                    {task.title}
                  </span>
                  {/* Urgency badge — same bg-danger/10 + text-danger
                      combo as the writeError alert above, just sized
                      down into a pill. A normal task gets nothing at
                      all, not a "normal" label. */}
                  {task.urgent ? (
                    <span className="shrink-0 rounded-pill bg-danger/10 px-xs py-2xs type-caption text-danger">
                      {t("tasks.urgent")}
                    </span>
                  ) : null}
                </span>
                {task.dueDate ? (
                  <span className="type-label text-muted">
                    {formatDueDate(task.dueDate, locale)}
                  </span>
                ) : null}
              </span>
              {/* Category dot — pushed to the end of the button via
                  ms-auto (RTL/LTR-correct); absent entirely (not just
                  hidden) when the task has no category, so no empty
                  gap is left. */}
              {cat ? (
                <span
                  aria-label={t(cat.labelKey)}
                  className={`ms-auto h-2 w-2 shrink-0 rounded-full ${cat.dotClassName}`}
                />
              ) : null}
            </button>

            {/* Edit — swaps the row for EditTaskForm inline. */}
            <button
              type="button"
              aria-label={t("tasks.edit")}
              onClick={() => setEditingId(task.id)}
              disabled={rowPending || rowDeleting}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-hairline text-muted interactive motion-safe:active:scale-[0.97]"
            >
              <ComposeIcon width={16} height={16} />
            </button>

            {/* Delete — a two-tap inline confirm (no modal, no window.confirm):
                first tap arms "Delete?", a second tap commits. Tapping another
                row's trash moves the confirm there. */}
            {confirming ? (
              <button
                type="button"
                aria-label={t("tasks.confirmDelete")}
                onClick={() => {
                  setConfirmId(null);
                  void removeTask(task.id);
                }}
                disabled={rowDeleting}
                className="shrink-0 rounded-pill bg-danger px-sm py-2xs type-caption text-on-fill interactive motion-safe:active:scale-[0.97]"
              >
                {t("tasks.confirmDelete")}
              </button>
            ) : (
              <button
                type="button"
                aria-label={t("tasks.delete")}
                onClick={() => setConfirmId(task.id)}
                disabled={rowDeleting}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-hairline text-muted interactive motion-safe:active:scale-[0.97]"
              >
                <CloseIcon width={16} height={16} />
              </button>
            )}
          </>
        )}
      </li>
    );
  }

  return (
    <>
      <div className="flex items-center gap-xs">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label={t("common.back")}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-ink interactive motion-safe:active:scale-[0.97]"
        >
          <ChevronIcon style={{ transform: dir === "rtl" ? "scaleX(-1)" : undefined }} />
        </button>
        <h1 className="flex-1 type-title text-ink">{t("tasks.name")}</h1>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="rounded-pill bg-app-violet px-md py-xs type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
        >
          {t("tasks.addTask")}
        </button>
      </div>

      {writeError ? (
        <p
          role="alert"
          className="flex items-start gap-xs rounded-md bg-danger/10 px-sm py-xs type-label text-danger"
        >
          <InfoIcon width={18} height={18} aria-hidden className="mt-2xs shrink-0" />
          <span>
            {t(writeError === "failed" ? "tasks.errorFailed" : "tasks.errorDenied")}
          </span>
        </p>
      ) : null}

      {adding ? (
        <AddTaskModal
          onCreated={(task) => {
            // create_task returns { id }; the rest of the row is exactly what we
            // submitted, so append it straight into the SHARED cache — no refetch,
            // and the dashboard card sees the new task immediately.
            queryClient.setQueryData<Task[]>(TASKS_LIST_KEY, (prev) => [...(prev ?? []), task]);
            setAdding(false);
            setWriteError(null);
          }}
          onError={(code) => setWriteError(code)}
          onClose={() => setAdding(false)}
        />
      ) : null}

      {view === "week" ? (
        <WeekView
          tasks={filteredTasks}
          weekStart={weekStart}
          onChangeWeekStart={setWeekStart}
          onToggle={toggleTask}
        />
      ) : filteredTasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-xs rounded-lg bg-card px-lg py-2xl text-center">
          <p className="type-heading text-ink">
            {t(filterHidesEverything ? "tasks.filterEmptyTitle" : "tasks.emptyTitle")}
          </p>
          <p className="max-w-[24ch] type-label text-muted">
            {t(filterHidesEverything ? "tasks.filterEmptyHint" : "tasks.emptyHint")}
          </p>
        </div>
      ) : filter === "all" ? (
        // Grouped by scheduling — ONLY for filter === "all" (scheduledGroup/
        // generalGroup above). Every other filter stays the single flat list
        // below, unchanged. An empty group renders NOTHING — no header sitting
        // over an empty body.
        <div className="flex flex-col gap-lg">
          {scheduledGroup.length > 0 ? (
            <div className="flex flex-col gap-xs">
              <div className="flex items-baseline gap-2xs">
                <span className="type-label text-muted">{t("tasks.scheduledLabel")}</span>
                <span className="type-label text-muted">{scheduledGroup.length}</span>
              </div>
              <ul className="flex flex-col divide-y divide-hairline">
                {scheduledGroup.map(renderTaskRow)}
              </ul>
            </div>
          ) : null}
          {generalGroup.length > 0 ? (
            <div className="flex flex-col gap-xs">
              <div className="flex items-baseline gap-2xs">
                <span className="type-label text-muted">{t("tasks.generalLabel")}</span>
                <span className="type-label text-muted">{generalGroup.length}</span>
              </div>
              <ul className="flex flex-col divide-y divide-hairline">
                {generalGroup.map(renderTaskRow)}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline">
          {filteredTasks.map(renderTaskRow)}
        </ul>
      )}

      <FilterBar filter={filter} onChange={setFilter} view={view} onViewChange={setView} />
    </>
  );
}

/**
 * Floating filter segmented control (iOS-style), pinned just above the shell's
 * TabBar. `sticky bottom-sm` (not `fixed`) so it rides the SAME scroll container
 * as the task list — no shell/portal wiring, no z-index fight with the AI sheet
 * (Standard §1: the tool never touches shell chrome). `mt-auto` is load-bearing
 * alongside it: `main` is a flex column stretched to the full viewport height, so
 * on a short/empty list `sticky` alone leaves this sitting right after the last
 * item with empty space below it — `mt-auto` pushes it to the bottom of that flex
 * column every time; `sticky` then takes over once the list is tall enough to
 * scroll. Transparent card surface + backdrop blur so the list is visible moving
 * underneath it.
 *
 * The leading hamburger is now WIRED: it opens a small popover (list/week)
 * ABOVE the button, own local `menuOpen` state (transient UI, unlike `view`
 * which FullScreen owns since it decides what renders). Filtering itself is a
 * pure client-side narrowing of the already shared task list — it never
 * triggers a fetch; `view` is a SEPARATE axis (how the filtered set is laid
 * out), never conflated with `filter` (which tasks are in that set).
 */
function FilterBar({
  filter,
  onChange,
  view,
  onViewChange,
}: {
  filter: TaskFilter;
  onChange: (next: TaskFilter) => void;
  view: TaskView;
  onViewChange: (next: TaskView) => void;
}) {
  const { t } = useI18n();
  const segments: Array<{ key: TaskFilter; labelKey: MessageKey }> = [
    { key: "all", labelKey: "tasks.filterAll" },
    { key: "open", labelKey: "tasks.filterOpen" },
    { key: "done", labelKey: "tasks.filterDone" },
    { key: "general", labelKey: "tasks.filterGeneral" },
  ];
  const viewOptions: Array<{ key: TaskView; labelKey: MessageKey }> = [
    { key: "list", labelKey: "tasks.viewList" },
    { key: "week", labelKey: "tasks.viewWeek" },
  ];

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on an outside click/tap — the popover doesn't have its own scrim,
  // so this is what keeps it from staying open once attention moves elsewhere.
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  return (
    <div className="sticky bottom-sm z-40 mt-auto flex w-fit shrink-0 items-center gap-2xs self-center rounded-pill border border-hairline bg-card/70 p-2xs shadow-lifted backdrop-blur-md">
      <div ref={menuRef} className="relative">
        <button
          type="button"
          aria-label={t("tasks.filterMenu")}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted interactive motion-safe:active:scale-[0.97]"
        >
          <MenuIcon width={18} height={18} />
        </button>
        {menuOpen ? (
          <div className="ds-panel absolute bottom-full start-0 z-50 mb-xs flex w-28 flex-col gap-2xs rounded-lg border border-hairline bg-card p-2xs shadow-lifted">
            {viewOptions.map((option) => {
              const active = view === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    onViewChange(option.key);
                    setMenuOpen(false);
                  }}
                  className={`rounded-md px-sm py-2xs text-start type-label interactive motion-safe:active:scale-[0.97] ${
                    active ? "bg-app-violet/15 text-app-violet" : "text-ink"
                  }`}
                >
                  {t(option.labelKey)}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      <span className="h-5 w-px shrink-0 bg-hairline" aria-hidden="true" />
      {segments.map((segment) => {
        const active = filter === segment.key;
        return (
          <button
            key={segment.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(segment.key)}
            className={`rounded-pill px-sm py-2xs type-label interactive motion-safe:active:scale-[0.97] ${
              active ? "bg-app-violet text-on-fill" : "text-muted"
            }`}
          >
            {t(segment.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Week view — buckets the (already-filtered) tasks into 7 day columns
 * starting Sunday. A SEPARATE axis from the filter bar's `filter`: this
 * component only decides layout, never which tasks are in `tasks`.
 *
 * Horizontal scroll + a fixed per-column minimum (`auto-cols-[minmax(...)]`)
 * handles narrow phones; on anything wide enough for all 7 at that minimum,
 * the `1fr` half of the `minmax()` lets them grow to fill the space evenly
 * instead of scrolling. RTL: no direction-specific code — CSS Grid's
 * `grid-auto-flow: column` places implicit columns along the inline axis,
 * which already flows start→end per `dir` (Sunday lands on the RIGHT in
 * Hebrew for free, since the day array itself is just Sunday→Saturday).
 */
function WeekView({
  tasks,
  weekStart,
  onChangeWeekStart,
  onToggle,
}: {
  tasks: Task[];
  weekStart: Date;
  onChangeWeekStart: (next: Date) => void;
  onToggle: (id: string, done: boolean) => void;
}) {
  const { t, dir, locale } = useI18n();
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = new Date();

  return (
    <div className="flex flex-col gap-sm">
      <div className="flex items-center justify-between gap-xs">
        <button
          type="button"
          aria-label={t("tasks.prevWeek")}
          onClick={() => onChangeWeekStart(addDays(weekStart, -7))}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card text-ink interactive motion-safe:active:scale-[0.97]"
        >
          <ChevronIcon style={{ transform: dir === "rtl" ? "scaleX(-1)" : undefined }} />
        </button>
        <span className="type-label text-muted">{formatWeekRangeLabel(weekStart, locale)}</span>
        <button
          type="button"
          aria-label={t("tasks.nextWeek")}
          onClick={() => onChangeWeekStart(addDays(weekStart, 7))}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card text-ink interactive motion-safe:active:scale-[0.97]"
        >
          <ChevronIcon style={{ transform: dir === "rtl" ? undefined : "scaleX(-1)" }} />
        </button>
      </div>

      <div className="overflow-x-auto no-scrollbar">
        <div className="grid grid-flow-col auto-cols-[minmax(6.5rem,1fr)] gap-xs">
          {days.map((day) => {
            // Tasks with NO due date never appear in the week view at all —
            // there is no column for them to belong to.
            const dayTasks = tasks.filter(
              (task) => task.dueDate && isSameLocalDay(new Date(task.dueDate), day),
            );
            const isToday = isSameLocalDay(day, today);
            return (
              <div
                key={day.toISOString()}
                className={`flex flex-col gap-xs rounded-lg p-xs ${
                  isToday ? "bg-app-violet/10" : "bg-card"
                }`}
              >
                <div className="flex flex-col items-center gap-2xs pb-2xs">
                  <span className={`type-caption ${isToday ? "text-app-violet" : "text-muted"}`}>
                    {formatWeekday(day, locale)}
                  </span>
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full type-label ${
                      isToday ? "bg-app-violet text-on-fill" : "text-ink"
                    }`}
                  >
                    {day.getDate()}
                  </span>
                </div>

                {dayTasks.length === 0 ? (
                  <p className="text-center type-caption text-muted">{t("tasks.dayEmpty")}</p>
                ) : (
                  <ul className="flex flex-col gap-2xs">
                    {dayTasks.map((task) => {
                      const cat = categoryOf(task.category);
                      return (
                        <li key={task.id}>
                          <button
                            type="button"
                            aria-label={[
                              task.done ? t("tasks.markUndone") : t("tasks.markDone"),
                              cat ? t(cat.labelKey) : null,
                              task.urgent ? t("tasks.urgent") : null,
                            ]
                              .filter(Boolean)
                              .join(" — ")}
                            aria-pressed={task.done}
                            onClick={() => onToggle(task.id, !task.done)}
                            className={`flex w-full min-w-0 items-center gap-2xs rounded-md px-2xs py-2xs text-start type-caption interactive motion-safe:active:scale-[0.97] ${
                              task.done
                                ? "bg-hairline text-muted line-through"
                                : task.urgent
                                  ? "bg-danger/10 text-danger"
                                  : "bg-app-violet/15 text-ink"
                            }`}
                          >
                            {/* Column is too narrow for a trailing dot without
                                crowding the already-truncated title — leads
                                the row instead (same rule as the list view:
                                present only when the task has a category).
                                Urgency has NO room for a separate label here —
                                see the row's own background/text swapping to
                                the danger token instead (chosen over a second
                                badge/icon: one glance at the tint already
                                reads "urgent" without adding more to parse in
                                an already-tiny cell). */}
                            {cat ? (
                              <span className={`h-2 w-2 shrink-0 rounded-full ${cat.dotClassName}`} />
                            ) : null}
                            <span className="truncate">{task.title}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Add-task MODAL (Standard §8: design-system + i18n only). A real overlay, not
 * an inline-in-flow form — it does not push the list down. Rendered as a plain
 * child of `FullScreen` (no portal, per instruction): `fixed inset-0` still
 * escapes the scrolling list correctly because nothing between here and the
 * document root sets a `transform`/`filter`/`will-change` (those are what
 * would turn `fixed` into scoped-to-that-ancestor — see AiSheet's own comment
 * on exactly this for why ITS nested popover needs a portal; this modal has no
 * such ancestor, so it does not).
 *
 * z-[70] intentionally matches the z-index the shell's OWN top-layer overlays
 * use (AiSheet's history popover: z-[60] backdrop / z-[70] panel) — TabBar sits
 * at z-50, so this clears it the same way, using the SAME numbers already
 * established for "must draw above everything," not a new convention.
 *
 * Submission/validation/error logic is UNCHANGED from the previous inline
 * form — only the chrome around it moved.
 */
function AddTaskModal({
  onCreated,
  onError,
  onClose,
}: {
  onCreated: (task: Task) => void;
  onError: (code: WriteErrorCode) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  // Date defaults to today — the common case. Clearing it is still a real "no
  // due date" (see handleSubmit), so the escape hatch stays open. Time
  // defaults EMPTY, deliberately: an auto-filled "now" would silently give
  // every task a time, which matters once a time-triggered reminder exists —
  // a time is only ever set when someone actually chooses one.
  const [date, setDate] = useState(todayDateValue);
  const [time, setTime] = useState("");
  // No category selected by default — picking one is optional, and the picker
  // itself supports deselecting back to null (see CategoryPicker).
  const [category, setCategory] = useState<string | null>(null);
  // Defaults to normal — the common case.
  const [urgent, setUrgent] = useState(false);
  // Defaults to "scheduled" — the common case. Switching to "general" disables
  // (not hides) the date field below, and forces the submitted due date to
  // null regardless of what's left in it (see handleSubmit).
  const [scheduling, setScheduling] = useState<TaskScheduling>("scheduled");
  // Whether the required title is blank-on-submit. Drives the marking + message;
  // cleared as soon as the user edits it.
  const [invalid, setInvalid] = useState<{ title: boolean }>({ title: false });
  // True while an add is in flight. Disables the submit button and makes a second
  // submit a no-op, so a double-tap can't write a duplicate row.
  const [submitting, setSubmitting] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  // Guard: onCreated/onError setState in the PARENT after the await. If we unmount
  // mid-submit, this stops us from touching the parent's state.
  const mounted = useRef(true);
  useEffect(() => {
    // Re-arm on every (re)mount. Under StrictMode React runs mount → cleanup →
    // mount; setting `true` here (not only `false` in cleanup) means the second
    // mount re-enables the guard instead of leaving it permanently disarmed,
    // which would swallow every later setState and strand the view empty.
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Focus the title field the instant the modal opens — it's the hero, and the
  // first thing typed.
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // Escape closes the modal, same as tapping the scrim or Cancel.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const invalidRing = "ring-1 ring-danger";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // A second submit while one is already in flight is a no-op (belt-and-suspenders
    // with the disabled button — this also covers Enter-key resubmits).
    if (submitting) return;

    const nextTitle = title.trim();

    // Required-field validation is VISIBLE now — a blank title marks itself and
    // says what is missing, instead of the submit silently doing nothing.
    const nextInvalid = { title: nextTitle === "" };
    setInvalid(nextInvalid);
    if (nextInvalid.title) return;

    // due_date is optional; an empty DATE is a real "no due date", not "" —
    // but an empty TIME is a real "no time", not a missing field (see
    // dateAndTimeToIso: it becomes midnight, which formatDueDate already
    // knows to display as date-only). A "general" task never carries a due
    // date, regardless of what's still sitting in the (disabled) fields —
    // the SAME rule logic.ts enforces server-side, mirrored here so the
    // optimistic row is never wrong.
    const nextDue =
      scheduling === "general" ? null : date.trim() === "" ? null : dateAndTimeToIso(date, time);

    // Lock only AFTER validation passes, so a failed validation leaves the button
    // usable. Released in `finally`, whatever the outcome.
    setSubmitting(true);
    try {
      // No ctx argument — the server builds it from the session.
      const res = await runIntentAction("tasks.create_task", {
        title: nextTitle,
        dueDate: nextDue ?? undefined,
        category: category ?? undefined,
        urgent,
        scheduling,
      });
      if (!mounted.current) return;

      if (res.ok) {
        // create_task returns only { id }; the rest of the Task is the values we
        // just submitted, so we can hand a complete row up to append.
        const { id } = res.data as { id: string };
        onCreated({
          id,
          title: nextTitle,
          done: false,
          dueDate: nextDue,
          category,
          urgent,
          scheduling,
        });
      } else {
        onError(res.code);
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  return (
    // The scrim: fills the viewport, dims what's behind, closes on tap. `p-md`
    // keeps the card off the screen edges on small phones.
    <div
      className="ds-backdrop fixed inset-0 z-[70] flex items-center justify-center bg-scrim p-md"
      onClick={onClose}
    >
      {/* stopPropagation: a tap ANYWHERE inside the card must not bubble to the
          scrim's onClose above. */}
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        // `w-[min(100%,24rem)]` (24rem = Tailwind's max-w-sm) instead of the
        // separate `w-full max-w-sm` pair: as a flex child of the scrim, the
        // card has no OTHER sibling competing for space, so `justify-center`
        // gave it room to just shrink to its content instead of actually
        // filling the row — `min()` computes one explicit width (the smaller
        // of "100% of the scrim's padded box" or the cap) with no flex-basis
        // ambiguity to fall into.
        className="ds-panel flex w-[min(100%,24rem)] flex-col gap-lg rounded-xl bg-card p-lg shadow-lifted"
      >
        {/* 1. Title — the hero. No label; the placeholder carries it, and the
            larger type size is what makes it the first thing the eye meets. */}
        <div className="flex flex-col gap-2xs">
          <input
            ref={titleRef}
            className={`w-full bg-transparent type-display text-ink outline-none placeholder:text-muted ${
              invalid.title ? invalidRing : ""
            }`}
            value={title}
            placeholder={t("tasks.titlePlaceholder")}
            onChange={(e) => {
              setTitle(e.target.value);
              if (invalid.title) setInvalid((v) => ({ ...v, title: false }));
            }}
            aria-label={t("tasks.taskTitle")}
            aria-required="true"
            aria-invalid={invalid.title}
          />
          {invalid.title ? (
            <span role="alert" className="type-caption text-danger">
              {t("tasks.fieldRequired")}
            </span>
          ) : null}
        </div>

        {/* 2. When — scheduling toggle + date + time, one row: the toggle is
            fixed-width (sized to its own content), date/time split the rest.
            Split into SEPARATE date/time inputs rather than one
            datetime-local — a single datetime-local control doesn't leave
            room for the toggle beside it in this modal's width. Both fields
            disabled (not hidden) when scheduling is "general" — a general
            task has nowhere to put a time, but stays visible so its purpose
            reads clearly, same as the old placeholder rows did. */}
        <div className="flex flex-col gap-2xs">
          <span className="type-caption text-muted">{t("tasks.whenLabel")}</span>
          <div className="flex items-center gap-xs">
            <SchedulingPicker value={scheduling} onChange={setScheduling} />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={scheduling === "general"}
              className={`min-w-0 flex-1 rounded-md bg-screen px-xs py-sm type-body text-ink outline-none ${
                scheduling === "general" ? "opacity-[var(--ds-disabled-opacity)]" : ""
              }`}
            />
            {/* Empty by default (see the `time` state comment above) — an
                unset time input just shows its placeholder glyphs, reading
                as "no time chosen" rather than a fabricated value. */}
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              disabled={scheduling === "general"}
              className={`min-w-0 flex-1 rounded-md bg-screen px-xs py-sm type-body text-ink outline-none ${
                scheduling === "general" ? "opacity-[var(--ds-disabled-opacity)]" : ""
              }`}
            />
          </div>
        </div>

        {/* 4. Category — the other placeholder, now real: optional,
            deselectable (see CategoryPicker). */}
        <div className="flex flex-col gap-2xs">
          <span className="type-caption text-muted">{t("tasks.category")}</span>
          <CategoryPicker value={category} onChange={setCategory} />
        </div>

        {/* 5. Urgency — same picker style as category. */}
        <div className="flex flex-col gap-2xs">
          <span className="type-caption text-muted">{t("tasks.urgencyLabel")}</span>
          <UrgencyPicker value={urgent} onChange={setUrgent} />
        </div>

        {/* 6. Actions — Add is the confident, filled primary; Cancel is
            transparent/secondary so the hierarchy stays unambiguous. */}
        <div className="flex gap-sm">
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 rounded-md bg-app-violet py-sm type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
          >
            {t("tasks.add")}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 rounded-md bg-transparent py-sm type-label text-muted interactive motion-safe:active:scale-[0.97]"
          >
            {t("tasks.cancel")}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Inline edit form — replaces a row in place (Standard §8: design-system + i18n
 * only). Owns its OWN local title/dueDate/validation/submitting state (mirrors
 * AddTaskForm); the actual write is delegated up to `onSave` (FullScreen's
 * `updateTask`), which is the one that touches the shared cache and `runIntentAction`
 * — this component only decides WHAT to save and shows the in-flight/invalid state.
 */
function EditTaskForm({
  task,
  onSave,
  onCancel,
}: {
  task: Task;
  onSave: (
    title: string,
    dueDate: string | null,
    category: string | null,
    urgent: boolean,
    scheduling: TaskScheduling,
  ) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(task.title);
  // BUG FIX (still applies): task.dueDate is a full timestamptz string (e.g.
  // "2026-07-16T14:30:00+00:00") — not the plain "YYYY-MM-DD"/"HH:mm" the date
  // and time inputs each expect. isoToDateAndTime converts it to the LOCAL
  // values they actually want — AND, per the same "midnight = no time"
  // convention used everywhere else, a task whose stored time IS exactly
  // local midnight opens with an EMPTY time field, not a fabricated "00:00"
  // that would look like someone deliberately chose midnight.
  const initialDateTime = isoToDateAndTime(task.dueDate);
  const [date, setDate] = useState(initialDateTime.date);
  const [time, setTime] = useState(initialDateTime.time);
  // Pre-selected from the task's current category (or none).
  const [category, setCategory] = useState<string | null>(task.category);
  // Pre-selected from the task's current urgency.
  const [urgent, setUrgent] = useState(task.urgent);
  // Pre-selected from the task's current scheduling.
  const [scheduling, setScheduling] = useState<TaskScheduling>(task.scheduling);
  const [invalid, setInvalid] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Guard: setSubmitting(false) in `finally` after the await. If the parent
  // closes/unmounts this form mid-save (e.g. success sets editingId to null),
  // this stops a state update on an unmounted component.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const inputClass =
    "w-full rounded-md bg-screen px-sm py-sm type-body text-ink outline-none placeholder:text-muted";
  const invalidRing = "ring-1 ring-danger";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    const nextTitle = title.trim();

    // Same visible-validation rule as AddTaskForm: a blank title marks itself
    // instead of silently not saving.
    if (nextTitle === "") {
      setInvalid(true);
      return;
    }

    // An emptied DATE is a real "no due date", not "" — but an emptied TIME
    // is a real "no time" (see dateAndTimeToIso: it becomes midnight, which
    // formatDueDate already knows to display as date-only). A "general" task
    // never carries a due date, regardless of what's still sitting in the
    // (disabled) fields — mirrors logic.ts's server-side rule.
    const nextDue =
      scheduling === "general" ? null : date.trim() === "" ? null : dateAndTimeToIso(date, time);

    setSubmitting(true);
    try {
      await onSave(nextTitle, nextDue, category, urgent, scheduling);
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label={t("tasks.editTask")}
      className="flex flex-1 flex-col gap-sm rounded-lg bg-card p-md"
    >
      <label className="flex flex-col gap-2xs type-label text-muted">
        <span>
          {t("tasks.taskTitle")} <span aria-hidden="true" className="text-danger">*</span>
        </span>
        <input
          className={invalid ? `${inputClass} ${invalidRing}` : inputClass}
          value={title}
          placeholder={t("tasks.titlePlaceholder")}
          onChange={(e) => {
            setTitle(e.target.value);
            if (invalid) setInvalid(false);
          }}
          aria-required="true"
          aria-invalid={invalid}
        />
        {invalid ? (
          <span role="alert" className="type-caption text-danger">
            {t("tasks.fieldRequired")}
          </span>
        ) : null}
      </label>
      {/* When — scheduling toggle + date + time, one row (see AddTaskModal's
          matching section for why: the toggle is fixed-width, date/time
          split the rest, and a single datetime-local doesn't leave room for
          the toggle beside it). `date`/`time` are independent state, seeded
          from isoToDateAndTime above — an empty `time` here means the task
          genuinely has none (see that function's "midnight = no time"
          convention), not that something failed to load. */}
      <div className="flex flex-col gap-2xs">
        <span className="type-label text-muted">{t("tasks.whenLabel")}</span>
        <div className="flex items-center gap-xs">
          <SchedulingPicker value={scheduling} onChange={setScheduling} />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={scheduling === "general"}
            className={`min-w-0 flex-1 rounded-md bg-screen px-xs py-sm type-body text-ink outline-none ${
              scheduling === "general" ? "opacity-[var(--ds-disabled-opacity)]" : ""
            }`}
          />
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            disabled={scheduling === "general"}
            className={`min-w-0 flex-1 rounded-md bg-screen px-xs py-sm type-body text-ink outline-none ${
              scheduling === "general" ? "opacity-[var(--ds-disabled-opacity)]" : ""
            }`}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2xs">
        <span className="type-label text-muted">{t("tasks.category")}</span>
        <CategoryPicker value={category} onChange={setCategory} />
      </div>
      <div className="flex flex-col gap-2xs">
        <span className="type-label text-muted">{t("tasks.urgencyLabel")}</span>
        <UrgencyPicker value={urgent} onChange={setUrgent} />
      </div>
      <div className="flex gap-xs">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 rounded-md bg-app-violet py-sm type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
        >
          {t("tasks.save")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="flex-1 rounded-md bg-hairline py-sm type-label text-ink interactive motion-safe:active:scale-[0.97]"
        >
          {t("tasks.cancel")}
        </button>
      </div>
    </form>
  );
}

/**
 * The shared "single segmented box" shell every picker below sits in: one
 * bg-screen frame with rounded corners, segments touching (no gap, no
 * border, no ring) so it reads as ONE control, not a row of separate
 * buttons. Only a segment's OWN background (passed in per-option) marks it
 * selected; unselected segments are fully transparent over the shared frame.
 */
const PICKER_FRAME = "flex items-stretch rounded-md bg-screen p-2xs";
const PICKER_SEGMENT =
  "flex-1 rounded-sm px-sm py-xs type-label interactive motion-safe:active:scale-[0.97]";

/**
 * Category picker — one segmented box, each segment carrying its own
 * identity color (Standard §8: the app-identity palette, never invented).
 * Shared by AddTaskModal and EditTaskForm so the interaction (select /
 * re-tap the SAME one to clear) and markup live in exactly one place.
 *
 * Selected: SOLID fill in that category's own color + `text-on-fill` (never
 * a generic accent — "the selected one gets the category's color"). The
 * small identity dot shows only on UNSELECTED segments, as a color preview
 * next to the muted label; on the selected segment the entire background
 * already IS that color, so the same dot would sit invisibly on top of it.
 *
 * Optional and deselectable: tapping the already-selected category clears it
 * back to null — there is no separate "none" segment, since these three ARE
 * the whole set (Standard §1: a closed UI-side list, see categories.ts).
 */
function CategoryPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const { t } = useI18n();
  return (
    <div className={PICKER_FRAME}>
      {CATEGORIES.map((cat) => {
        const selected = value === cat.key;
        return (
          <button
            key={cat.key}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(selected ? null : cat.key)}
            className={`${PICKER_SEGMENT} flex items-center justify-center gap-2xs ${
              selected ? `${cat.dotClassName} text-on-fill` : "bg-transparent text-muted"
            }`}
          >
            {selected ? null : (
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${cat.dotClassName}`} />
            )}
            {t(cat.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Urgency picker — one segmented box, same shell as CategoryPicker (shared by
 * AddTaskModal and EditTaskForm). A plain boolean with no "clear" state:
 * Normal IS the off state, so there's nothing to deselect back to.
 *
 * Colors are deliberately NOT symmetric: "Urgent" selected is a SOLID
 * `danger` fill — a SEMANTIC role token, correct here because urgency is
 * genuinely a meaning/severity signal (Standard §8), unlike category's
 * identity colors. "Normal" selected has no comparable meaning to signal, so
 * it uses this tool's own app-violet identity instead of inventing one.
 */
function UrgencyPicker({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  const { t } = useI18n();
  const options: Array<{ key: boolean; labelKey: MessageKey }> = [
    { key: false, labelKey: "tasks.normal" },
    { key: true, labelKey: "tasks.urgent" },
  ];
  return (
    <div className={PICKER_FRAME}>
      {options.map((option) => {
        const selected = value === option.key;
        return (
          <button
            key={String(option.key)}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.key)}
            className={`${PICKER_SEGMENT} ${
              selected
                ? option.key
                  ? "bg-danger text-on-fill"
                  : "bg-app-violet text-on-fill"
                : "bg-transparent text-muted"
            }`}
          >
            {t(option.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Scheduling picker — Today (scheduled) vs General, same segmented-box shell
 * and the SAME app-violet-for-either-selection treatment as UrgencyPicker's
 * "Normal": neither state is more severe than the other, they're just two
 * equal values of one axis, so one identity color marks whichever is picked.
 */
function SchedulingPicker({
  value,
  onChange,
}: {
  value: TaskScheduling;
  onChange: (next: TaskScheduling) => void;
}) {
  const { t } = useI18n();
  const options: Array<{ key: TaskScheduling; labelKey: MessageKey }> = [
    { key: "scheduled", labelKey: "tasks.scheduledLabel" },
    { key: "general", labelKey: "tasks.generalLabel" },
  ];
  return (
    <div className={`${PICKER_FRAME} shrink-0`}>
      {options.map((option) => {
        const selected = value === option.key;
        return (
          <button
            key={option.key}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.key)}
            className={`${PICKER_SEGMENT} ${
              selected ? "bg-app-violet text-on-fill" : "bg-transparent text-muted"
            }`}
          >
            {t(option.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
