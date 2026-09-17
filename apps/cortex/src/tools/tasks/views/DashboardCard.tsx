"use client";

/**
 * Tasks dashboard card (Standard §2 `views/DashboardCard.tsx`, §8). Cloned from
 * Inventory's card, on the app-violet (indigo) identity accent.
 *
 * THREE STATES, MODELLED EXPLICITLY:
 *   - loading           → a skeleton (header as-is + placeholder rows), never a
 *                          flash of empty.
 *   - loaded, has tasks → the full list, scrolling INSIDE the card once it
 *                          outgrows the fixed height (see below) — never sliced.
 *   - loaded, no tasks  → an explicit "nothing on your list" body, not a blank card.
 *   - error             → a short muted "couldn't load" line, never silently blank.
 *
 * Reads through the SHARED react-query cache (`useTasksList`, queryKey
 * ["tasks","list"]) — the SAME cache the full screen uses, so opening the full
 * screen paints instantly from cache and revalidates in the background. The query's
 * fetch is still the SERVER action (`runIntentAction`), which builds ctx from the
 * session, so every fetch (including a background refetch) is re-authenticated; the
 * client never carries identity.
 *
 * FIXED HEIGHT (~1/3 of the visible viewport): `--app-vh` is the SAME variable
 * `AppShell` drives from VisualViewport (not bare `dvh` — see its comment on why
 * Android's collapsing URL bar makes `dvh` alone unreliable). The card fixes its
 * OWN height from it and scrolls its OWN list internally — it does not touch
 * AppShell or any shared component to do this.
 *
 * QUICK ADD + QUICK TOGGLE: Home already wraps this whole card in a `<Link>` to
 * the full screen (`HomeView.tsx`) — tapping the card body to open the tool
 * needed no change here. The "+" button, its inline form, and each row's
 * done-toggle circle all call BOTH `preventDefault` and `stopPropagation` on
 * click: the ancestor `<a>`'s navigation is decided by the event's
 * `defaultPrevented` flag, not by whether propagation reached it, so
 * `stopPropagation` alone does not stop it — `preventDefault` is the one that
 * matters. Every write reconciles the SAME shared cache the full screen reads
 * (`setQueryData`), exactly like the full screen's own handlers, so a change
 * made from Home is already there if the tool is opened next.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { runIntentAction, type IntentResult } from "@/cortex/actions";
import { CheckIcon, PlusIcon } from "@/components/icons";
import { useTasksList, TASKS_LIST_KEY } from "@/lib/query/useTasksList";
import type { Task } from "../logic";
import { formatDueDate } from "../dateFormat";

/** The failure codes a write can come back with (from {@link IntentResult}). */
type WriteErrorCode = Extract<IntentResult, { ok: false }>["code"];

/** Muted placeholder block. `bg-hairline` is a token; `motion-safe:animate-pulse`
 * so reduced-motion users get a static (still visible) skeleton, not a pulse. */
const SKELETON = "rounded-md bg-hairline motion-safe:animate-pulse";

// The page passes userId/orgId (it called requireSession()), but this view does
// NOT send them anywhere: the server action derives identity from the session
// cookie, never from a client-supplied value — that is the whole defence. They
// stay in the prop TYPE only because the page provides them; `_props` marks them
// deliberately unused here.
export function DashboardCard(_props: ToolViewProps) {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  // From the shared query cache. react-query's `isLoading` is "pending AND no cached
  // data yet", so the skeleton shows only on the very first load; arriving from the
  // full screen (cache already warm) paints the list immediately, no skeleton flash.
  const { tasks, isLoading: loading, isError: error } = useTasksList();

  const open = tasks.filter((task) => !task.done);

  // Quick-add: a single-title inline form, toggled by the "+" button. Deliberately
  // simpler than the full screen's add form (no due date) — this is the fast path.
  const [quickAdding, setQuickAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [quickError, setQuickError] = useState<WriteErrorCode | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Guards the async setState below: the card can unmount mid-submit (e.g. the
  // user navigates away) — same pattern as the full screen's add form.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Focus the input the moment the inline form opens, so tapping "+" goes
  // straight to typing.
  useEffect(() => {
    if (quickAdding) inputRef.current?.focus();
  }, [quickAdding]);

  const submitQuickAdd = useCallback(async () => {
    const nextTitle = title.trim();
    if (nextTitle === "" || submitting) return;
    setSubmitting(true);
    setQuickError(null);
    try {
      const res = await runIntentAction("tasks.create_task", { title: nextTitle });
      if (!mounted.current) return;
      if (res.ok) {
        // create_task returns only { id }; the rest of the row is exactly what
        // was submitted, so append it straight into the SHARED cache — no
        // refetch, and the full screen sees it immediately if opened next.
        const { id } = res.data as { id: string };
        const created: Task = { id, title: nextTitle, done: false, dueDate: null };
        queryClient.setQueryData<Task[]>(TASKS_LIST_KEY, (prev) => [...(prev ?? []), created]);
        setTitle("");
        setQuickAdding(false);
      } else {
        setQuickError(res.code);
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }, [title, submitting, queryClient]);

  // Quick toggle: tapping a row's done circle flips it without opening the full
  // screen. Same optimistic-write-then-reconcile shape as FullScreen's
  // toggleTask — patch the shared cache immediately, revert it if the server
  // says no.
  const pendingRef = useRef<Set<string>>(new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(pendingRef.current);

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
      if (pendingRef.current.has(id)) return;
      const nextPending = new Set(pendingRef.current).add(id);
      pendingRef.current = nextPending;
      setPending(nextPending);

      setQuickError(null);
      patchTask(id, (it) => ({ ...it, done }));

      try {
        const res = await runIntentAction("tasks.toggle_task", { id, done });
        if (res.ok) {
          const { id: rid, done: rdone } = res.data as { id: string; done: boolean };
          patchTask(rid, (it) => ({ ...it, done: rdone }));
        } else {
          patchTask(id, (it) => ({ ...it, done: !done }));
          if (mounted.current) setQuickError(res.code);
        }
      } finally {
        const cleared = new Set(pendingRef.current);
        cleared.delete(id);
        pendingRef.current = cleared;
        if (mounted.current) setPending(cleared);
      }
    },
    [patchTask],
  );

  return (
    <div
      className="flex flex-col rounded-lg bg-card p-md"
      // ~1/3 of the REAL visible viewport (see file header) — fixed regardless
      // of task count; the list below scrolls internally instead of growing this.
      style={{ height: "calc(var(--app-vh, 100dvh) / 3)" }}
    >
      <div className="mb-sm flex shrink-0 items-center justify-between gap-xs">
        <div className="flex min-w-0 items-center gap-xs">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-app-violet/15 text-app-violet">
            <CheckIcon width={20} height={20} />
          </span>
          <span className="truncate type-heading text-ink">{t("tasks.name")}</span>
        </div>
        <div className="flex shrink-0 items-center gap-xs">
          {/* Status: a skeleton while loading (we don't know the count yet), nothing
              on error (the body carries the message), the open count otherwise. */}
          {loading ? (
            <span className={`h-4 w-20 ${SKELETON}`} aria-hidden="true" />
          ) : error ? null : (
            <span className={`type-label ${open.length > 0 ? "text-ink" : "text-muted"}`}>
              {open.length > 0 ? `${open.length} ${t("tasks.openTasks")}` : t("tasks.allDone")}
            </span>
          )}
          {/* Quick add. `stopPropagation` keeps every tap here from reaching the
              `<Link>` Home wraps this card in — only the card BODY navigates. */}
          <button
            type="button"
            aria-label={t("tasks.addTask")}
            aria-pressed={quickAdding}
            onClick={(e) => {
              // `preventDefault` is the one that actually matters here: the
              // ancestor `<a>`'s navigation is decided by `defaultPrevented` on
              // the event, not by whether propagation reached it.
              // `stopPropagation` is kept alongside it (belt-and-suspenders,
              // blocks any other ancestor click handler too).
              e.preventDefault();
              e.stopPropagation();
              setQuickError(null);
              setQuickAdding((v) => !v);
            }}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-app-violet text-on-fill interactive motion-safe:active:scale-[0.97]"
          >
            <PlusIcon width={16} height={16} />
          </button>
        </div>
      </div>

      {quickAdding ? (
        <form
          // Catch-all for the INPUT's own click (focusing it still bubbles a
          // click through the form to the `<a>`). `preventDefault` here is safe
          // for the input: focus is a `mousedown` default action, not `click`,
          // so it does not stop the field from focusing/typing.
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          // Enter-key submit only (the confirm BUTTON below is `type="button"`
          // and submits itself directly — see its own comment for why).
          onSubmit={(e) => {
            e.preventDefault();
            void submitQuickAdd();
          }}
          className="mb-sm flex shrink-0 items-center gap-xs"
        >
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("tasks.titlePlaceholder")}
            disabled={submitting}
            className="min-w-0 flex-1 rounded-md bg-screen px-sm py-xs type-body text-ink outline-none placeholder:text-muted"
          />
          <button
            // Deliberately `type="button"`, not `type="submit"`: a `preventDefault`
            // called from an ANCESTOR (the form's onClick, above) cancels the
            // clicked element's own default action too — so a submit button here
            // would lose its click-to-submit behavior. As a plain button it has no
            // default action to lose, and it drives the same submit function
            // directly. Enter-key submission still goes through the form's
            // onSubmit above, unaffected (a keypress never bubbles a click to the
            // ancestor `<a>`).
            type="button"
            aria-label={t("tasks.add")}
            disabled={submitting || title.trim() === ""}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void submitQuickAdd();
            }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-app-violet text-on-fill interactive motion-safe:active:scale-[0.97]"
          >
            <CheckIcon width={16} height={16} />
          </button>
        </form>
      ) : null}

      {quickError ? (
        <p role="alert" className="mb-sm shrink-0 type-caption text-danger">
          {t(quickError === "failed" ? "tasks.errorFailed" : "tasks.errorDenied")}
        </p>
      ) : null}

      {/* The scrolling region: everything above is fixed-height chrome, this is
          the only part that grows past the card's ~1/3-viewport height. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <ul className="flex flex-col divide-y divide-hairline" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex items-center justify-between py-sm">
                <span className={`h-4 w-28 ${SKELETON}`} />
                <span className={`h-4 w-12 ${SKELETON}`} />
              </li>
            ))}
          </ul>
        ) : error ? (
          <p className="type-label text-muted">{t("tasks.loadFailed")}</p>
        ) : tasks.length > 0 ? (
          <ul className="flex flex-col divide-y divide-hairline">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-center justify-between gap-sm py-sm">
                <span className="flex min-w-0 items-center gap-xs type-body">
                  {/* Done/undone toggle: a violet check circle when done, a muted
                      empty circle otherwise. A real button (not the row) so
                      tapping it flips the task instead of opening the full
                      screen — see the file header on why BOTH preventDefault
                      and stopPropagation are needed to stop the ancestor
                      `<Link>` from navigating. */}
                  <button
                    type="button"
                    aria-label={t(task.done ? "tasks.markUndone" : "tasks.markDone")}
                    aria-pressed={task.done}
                    disabled={pending.has(task.id)}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void toggleTask(task.id, !task.done);
                    }}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full interactive motion-safe:active:scale-[0.9] ${
                      task.done ? "bg-app-violet text-on-fill" : "bg-hairline text-muted"
                    }`}
                  >
                    {task.done ? <CheckIcon width={14} height={14} /> : null}
                  </button>
                  <span className={`truncate ${task.done ? "text-muted line-through" : "text-ink"}`}>
                    {task.title}
                  </span>
                </span>
                {task.dueDate ? (
                  <span className="shrink-0 type-label text-muted">
                    {formatDueDate(task.dueDate, locale)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="type-label text-muted">{t("tasks.allDoneBody")}</p>
        )}
      </div>
    </div>
  );
}
