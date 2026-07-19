"use client";

/**
 * Tasks dashboard card (Standard §2 `views/DashboardCard.tsx`, §8). Cloned from
 * Inventory's card, on the app-violet (indigo) identity accent.
 *
 * THREE STATES, MODELLED EXPLICITLY:
 *   - loading           → a skeleton (header as-is + placeholder rows), never a
 *                          flash of empty.
 *   - loaded, has tasks → the first few tasks, each with a done/undone check.
 *   - loaded, no tasks  → an explicit "nothing on your list" body, not a blank card.
 *   - error             → a short muted "couldn't load" line, never silently blank.
 *
 * Reads through the SHARED react-query cache (`useTasksList`, queryKey
 * ["tasks","list"]) — the SAME cache the full screen uses, so opening the full
 * screen paints instantly from cache and revalidates in the background. The query's
 * fetch is still the SERVER action (`runIntentAction`), which builds ctx from the
 * session, so every fetch (including a background refetch) is re-authenticated; the
 * client never carries identity.
 */
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { CheckIcon } from "@/components/icons";
import { useTasksList } from "@/lib/query/useTasksList";

/** Cap on preview rows so the Home card stays a fixed height (matching the other
 * preview cards) no matter how many tasks there are — the header count still shows
 * the real open total. */
const MAX_PREVIEW_ROWS = 4;

/** Muted placeholder block. `bg-hairline` is a token; `motion-safe:animate-pulse`
 * so reduced-motion users get a static (still visible) skeleton, not a pulse. */
const SKELETON = "rounded-md bg-hairline motion-safe:animate-pulse";

// The page passes userId/orgId (it called requireSession()), but this view does
// NOT send them anywhere: the server action derives identity from the session
// cookie, never from a client-supplied value — that is the whole defence. They
// stay in the prop TYPE only because the page provides them; `_props` marks them
// deliberately unused here.
export function DashboardCard(_props: ToolViewProps) {
  const { t } = useI18n();
  // From the shared query cache. react-query's `isLoading` is "pending AND no cached
  // data yet", so the skeleton shows only on the very first load; arriving from the
  // full screen (cache already warm) paints the list immediately, no skeleton flash.
  const { tasks, isLoading: loading, isError: error } = useTasksList();

  const open = tasks.filter((task) => !task.done);

  return (
    <div className="rounded-lg bg-card p-md">
      <div className="mb-sm flex items-center justify-between">
        <div className="flex items-center gap-xs">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-app-violet/15 text-app-violet">
            <CheckIcon width={20} height={20} />
          </span>
          <span className="type-heading text-ink">{t("tasks.name")}</span>
        </div>
        {/* Status: a skeleton while loading (we don't know the count yet), nothing
            on error (the body carries the message), the open count otherwise. */}
        {loading ? (
          <span className={`h-4 w-20 ${SKELETON}`} aria-hidden="true" />
        ) : error ? null : (
          <span className={`type-label ${open.length > 0 ? "text-ink" : "text-muted"}`}>
            {open.length > 0 ? `${open.length} ${t("tasks.openTasks")}` : t("tasks.allDone")}
          </span>
        )}
      </div>

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
          {tasks.slice(0, MAX_PREVIEW_ROWS).map((task) => (
            <li
              key={task.id}
              className="flex items-center justify-between gap-sm py-sm"
            >
              <span className="flex min-w-0 items-center gap-xs type-body">
                {/* Done/undone visual: a violet check circle when done, a muted
                    empty circle otherwise. */}
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                    task.done ? "bg-app-violet text-on-fill" : "bg-hairline text-muted"
                  }`}
                >
                  {task.done ? <CheckIcon width={14} height={14} /> : null}
                </span>
                <span className={`truncate ${task.done ? "text-muted line-through" : "text-ink"}`}>
                  {task.title}
                </span>
              </span>
              {task.dueDate ? (
                <span className="type-label text-muted" dir="ltr">
                  {task.dueDate.slice(0, 10)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="type-label text-muted">{t("tasks.allDoneBody")}</p>
      )}
    </div>
  );
}
