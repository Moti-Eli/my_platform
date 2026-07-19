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
import { useI18n } from "@/i18n";
import { ChevronIcon, CheckIcon, InfoIcon } from "@/components/icons";
import type { Task } from "../logic";
import { useTasksList, TASKS_LIST_KEY } from "@/lib/query/useTasksList";

/** The failure codes a write can come back with (from {@link IntentResult}). */
type WriteErrorCode = Extract<IntentResult, { ok: false }>["code"];

// userId/orgId arrive as props (the page called requireSession()) but are NOT
// sent to the action — the server derives identity from the session cookie. They
// stay in the prop type only because the page provides them; `_props` marks them
// deliberately unused.
export function FullScreen(_props: ToolViewProps) {
  const { t, dir } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  // The READ: straight from the shared query cache — this screen is a reader of the
  // SAME entry the dashboard card reads. It renders from the cache (the single
  // source of truth) and writes back into it via setQueryData, so the two views can
  // never hold diverging copies. Arriving from the card, the cache is warm and the
  // list paints instantly; react-query revalidates in the background.
  const { tasks } = useTasksList();
  const [adding, setAdding] = useState(false);
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
        <AddTaskForm
          onCreated={(task) => {
            // create_task returns { id }; the rest of the row is exactly what we
            // submitted, so append it straight into the SHARED cache — no refetch,
            // and the dashboard card sees the new task immediately.
            queryClient.setQueryData<Task[]>(TASKS_LIST_KEY, (prev) => [...(prev ?? []), task]);
            setAdding(false);
            setWriteError(null);
          }}
          onError={(code) => setWriteError(code)}
        />
      ) : null}

      {tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-xs rounded-lg bg-card px-lg py-2xl text-center">
          <p className="type-heading text-ink">{t("tasks.emptyTitle")}</p>
          <p className="max-w-[24ch] type-label text-muted">{t("tasks.emptyHint")}</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline">
          {tasks.map((task) => {
            // This row has a toggle in flight — disable its checkbox so a second tap
            // can't double-apply. Other rows are unaffected.
            const rowPending = pending.has(task.id);
            return (
              <li key={task.id} className="flex items-center gap-sm py-sm">
                <button
                  type="button"
                  aria-label={task.done ? t("tasks.markUndone") : t("tasks.markDone")}
                  aria-pressed={task.done}
                  onClick={() => toggleTask(task.id, !task.done)}
                  disabled={rowPending}
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
                    <span
                      className={`truncate type-heading ${
                        task.done ? "text-muted line-through" : "text-ink"
                      }`}
                    >
                      {task.title}
                    </span>
                    {task.dueDate ? (
                      <span className="type-label text-muted" dir="ltr">
                        {task.dueDate.slice(0, 10)}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function AddTaskForm({
  onCreated,
  onError,
}: {
  onCreated: (task: Task) => void;
  onError: (code: WriteErrorCode) => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  // Whether the required title is blank-on-submit. Drives the marking + message;
  // cleared as soon as the user edits it.
  const [invalid, setInvalid] = useState<{ title: boolean }>({ title: false });
  // True while an add is in flight. Disables the submit button and makes a second
  // submit a no-op, so a double-tap can't write a duplicate row.
  const [submitting, setSubmitting] = useState(false);

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

  const inputClass =
    "w-full rounded-md bg-screen px-sm py-sm type-body text-ink outline-none placeholder:text-muted";
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

    // due_date is optional; an empty input is a real "no due date", not "".
    const nextDue = dueDate.trim() === "" ? null : dueDate;

    // Lock only AFTER validation passes, so a failed validation leaves the button
    // usable. Released in `finally`, whatever the outcome.
    setSubmitting(true);
    try {
      // No ctx argument — the server builds it from the session.
      const res = await runIntentAction("tasks.create_task", {
        title: nextTitle,
        dueDate: nextDue ?? undefined,
      });
      if (!mounted.current) return;

      if (res.ok) {
        // create_task returns only { id }; the rest of the Task is the values we
        // just submitted, so we can hand a complete row up to append.
        const { id } = res.data as { id: string };
        onCreated({ id, title: nextTitle, done: false, dueDate: nextDue });
      } else {
        onError(res.code);
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-sm rounded-lg bg-card p-md">
      <label className="flex flex-col gap-2xs type-label text-muted">
        <span>
          {t("tasks.taskTitle")} <span aria-hidden="true" className="text-danger">*</span>
        </span>
        <input
          className={invalid.title ? `${inputClass} ${invalidRing}` : inputClass}
          value={title}
          placeholder={t("tasks.titlePlaceholder")}
          onChange={(e) => {
            setTitle(e.target.value);
            if (invalid.title) setInvalid((v) => ({ ...v, title: false }));
          }}
          aria-required="true"
          aria-invalid={invalid.title}
        />
        {invalid.title ? (
          <span role="alert" className="type-caption text-danger">
            {t("tasks.fieldRequired")}
          </span>
        ) : null}
      </label>
      <label className="flex flex-col gap-2xs type-label text-muted">
        {t("tasks.dueDate")}
        <input
          className={inputClass}
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-app-violet py-sm type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
      >
        {t("tasks.add")}
      </button>
    </form>
  );
}
