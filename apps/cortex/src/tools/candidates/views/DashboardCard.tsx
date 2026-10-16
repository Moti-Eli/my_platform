"use client";

/**
 * Candidates dashboard card (Standard §2 `views/DashboardCard.tsx`, §8) — a
 * CONDENSED version of the full screen, in the same redesigned language: one
 * bg-card surface, no nested boxes, no dividers (spacing only), monogram
 * avatars shared with the rows (initialsOf — one definition, no drift), and
 * app-blue as accent only.
 *
 * PIPELINE = ACTIVE ONLY. Archived candidates live in the full screen's
 * drawer, not the pipeline: the header count, the preview people and the
 * per-stage summary line all exclude them.
 *
 * FOUR STATES, MODELLED EXPLICITLY:
 *   - loading             → a skeleton matching the people-row shape (no
 *                           geometry flash), never a flash of empty.
 *   - loaded, has actives → the 3 most recent active candidates + a quiet
 *                           per-stage totals line.
 *   - loaded, none active → an explicit "nothing here yet" body, not a blank card.
 *   - error               → a short muted "couldn't load" line, never silently blank.
 *
 * Reads through the SHARED react-query cache (`useCandidatesList`, queryKey
 * ["candidates","list"]) — the SAME cache the full screen uses, so opening the
 * full screen paints instantly from cache and revalidates in the background.
 * The query's fetch is still the SERVER action (`runIntentAction`), which
 * builds ctx from the session, so every fetch (including a background refetch)
 * is re-authenticated; the client never carries identity.
 */
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { IdCardIcon } from "@/components/icons";
import { useCandidatesList } from "@/lib/query/useCandidatesList";
import { STAGE_LABEL_KEY, VISIBLE_STAGES, initialsOf, type VisibleStage } from "./CandidateCard";

/** How many recent active candidates the card previews. The summary line below
 * carries the full per-stage totals, so overflow loses nothing. */
const MAX_PREVIEW_ROWS = 3;

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
  const { candidates, isLoading: loading, isError: error } = useCandidatesList();

  // The PIPELINE: active candidates only — archived rows belong to the drawer.
  const active = candidates.filter((it) => it.stage !== "archived");
  // Most recent first: the shared list is created_at ASCENDING, so recency is
  // the tail of the list.
  const recent = active.slice(-MAX_PREVIEW_ROWS).reverse();
  // The quiet totals line: "contact 2 · interview 1 · intake 0" — always all
  // three stages, zeros included.
  const totalsLine = VISIBLE_STAGES.map(
    (stage) => `${t(STAGE_LABEL_KEY[stage])} ${active.filter((it) => it.stage === stage).length}`,
  ).join(" · ");

  return (
    <div className="rounded-lg bg-card p-md">
      <div className="mb-sm flex items-center justify-between">
        <div className="flex items-center gap-xs">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-app-blue/15 text-app-blue">
            <IdCardIcon width={20} height={20} />
          </span>
          <span className="type-heading text-ink">{t("candidates.name")}</span>
        </div>
        {/* Status: a skeleton while loading (we don't know the count yet), nothing
            on error (the body carries the message), the ACTIVE count otherwise. */}
        {loading ? (
          <span className={`h-4 w-20 ${SKELETON}`} aria-hidden="true" />
        ) : error ? null : (
          <span className={`type-label ${active.length > 0 ? "text-ink" : "text-muted"}`}>
            {active.length > 0
              ? `${active.length} ${t("candidates.candidateCount")}`
              : t("candidates.emptyBadge")}
          </span>
        )}
      </div>

      {loading ? (
        // Same geometry as the people rows below — avatar disc + two text bars —
        // so load → loaded never reflows.
        <ul className="flex flex-col gap-xs" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-sm">
              <span className="h-10 w-10 shrink-0 rounded-full bg-hairline motion-safe:animate-pulse" />
              <span className={`h-4 w-28 ${SKELETON}`} />
              <span className={`h-3 w-12 ${SKELETON}`} />
            </li>
          ))}
        </ul>
      ) : error ? (
        <p className="type-label text-muted">{t("candidates.loadFailed")}</p>
      ) : active.length > 0 ? (
        <div className="flex flex-col gap-sm">
          {/* People, not numbers: the most recent actives, monogram-first —
              spacing between rows, never dividers. */}
          <ul className="flex flex-col gap-xs">
            {recent.map((candidate) => (
              <li key={candidate.id} className="flex items-center gap-sm">
                {/* The rows' monogram recipe (row scale), from the one shared
                    initialsOf. */}
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-app-blue/10 type-label text-app-blue"
                >
                  {initialsOf(candidate.name)}
                </span>
                <span className="min-w-0 flex-1 truncate type-label text-ink">
                  {candidate.name}
                </span>
                {/* `active` excludes archived, so the stage is a VisibleStage —
                    the filter just doesn't narrow the type. */}
                <span className="shrink-0 type-caption text-muted">
                  {t(STAGE_LABEL_KEY[candidate.stage as VisibleStage])}
                </span>
              </li>
            ))}
          </ul>
          {/* The pipeline at a glance — one quiet line, zeros included. */}
          <p className="type-caption text-muted">{totalsLine}</p>
        </div>
      ) : (
        <p className="type-label text-muted">{t("candidates.emptyBody")}</p>
      )}
    </div>
  );
}
