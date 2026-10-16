"use client";

/**
 * Notes dashboard card (Standard §2 `views/DashboardCard.tsx`, §8). Cloned from
 * Tasks' card, on the app-coral identity accent.
 *
 * THREE STATES, MODELLED EXPLICITLY:
 *   - loading            → a skeleton (header as-is + placeholder rows), never a
 *                          flash of empty.
 *   - loaded, has notes  → the first few note titles.
 *   - loaded, no notes   → an explicit "nothing here yet" body, not a blank card.
 *   - error              → a short muted "couldn't load" line, never silently blank.
 *
 * Reads through the SHARED react-query cache (`useNotesList`, queryKey
 * ["notes","list"]) — the SAME cache the full screen uses, so opening the full
 * screen paints instantly from cache and revalidates in the background. The query's
 * fetch is still the SERVER action (`runIntentAction`), which builds ctx from the
 * session, so every fetch (including a background refetch) is re-authenticated; the
 * client never carries identity.
 */
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { DocumentIcon } from "@/components/icons";
import { useNotesList } from "@/lib/query/useNotesList";

/** Cap on preview rows so the Home card stays a fixed height (matching the other
 * preview cards) no matter how many notes there are — the header count still shows
 * the real total. */
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
  const { notes, isLoading: loading, isError: error } = useNotesList();

  return (
    <div className="rounded-lg bg-card p-md">
      <div className="mb-sm flex items-center justify-between">
        <div className="flex items-center gap-xs">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-app-coral/15 text-app-coral">
            <DocumentIcon width={20} height={20} />
          </span>
          <span className="type-heading text-ink">{t("notes.name")}</span>
        </div>
        {/* Status: a skeleton while loading (we don't know the count yet), nothing
            on error (the body carries the message), the note count otherwise. */}
        {loading ? (
          <span className={`h-4 w-20 ${SKELETON}`} aria-hidden="true" />
        ) : error ? null : (
          <span className={`type-label ${notes.length > 0 ? "text-ink" : "text-muted"}`}>
            {notes.length > 0 ? `${notes.length} ${t("notes.noteCount")}` : t("notes.emptyBadge")}
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
        <p className="type-label text-muted">{t("notes.loadFailed")}</p>
      ) : notes.length > 0 ? (
        <ul className="flex flex-col divide-y divide-hairline">
          {notes.slice(0, MAX_PREVIEW_ROWS).map((note) => (
            <li key={note.id} className="flex items-center gap-sm py-sm">
              <span className="flex min-w-0 items-center gap-xs type-body">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-app-coral/15 text-app-coral">
                  <DocumentIcon width={14} height={14} />
                </span>
                <span className="truncate text-ink">{note.title}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="type-label text-muted">{t("notes.emptyBody")}</p>
      )}
    </div>
  );
}
