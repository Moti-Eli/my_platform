"use client";

/**
 * Candidates dashboard card (Standard §2 `views/DashboardCard.tsx`, §8). Cloned
 * from Notes' card, on the app-blue identity accent.
 *
 * THREE STATES, MODELLED EXPLICITLY:
 *   - loading                 → a skeleton (header as-is + placeholder rows),
 *                               never a flash of empty.
 *   - loaded, has candidates  → per-stage counts (the pipeline at a glance).
 *   - loaded, no candidates   → an explicit "nothing here yet" body, not a blank card.
 *   - error                   → a short muted "couldn't load" line, never silently blank.
 *
 * Reads through the SHARED react-query cache (`useCandidatesList`, queryKey
 * ["candidates","list"]) — the SAME cache the full screen uses, so opening the full
 * screen paints instantly from cache and revalidates in the background. The query's
 * fetch is still the SERVER action (`runIntentAction`), which builds ctx from the
 * session, so every fetch (including a background refetch) is re-authenticated; the
 * client never carries identity.
 */
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { IdCardIcon } from "@/components/icons";
import { CANDIDATE_STAGES } from "@/tools/candidates/logic";
import { useCandidatesList } from "@/lib/query/useCandidatesList";

/** Stage → its i18n label key (same map the full screen uses for its sections). */
const STAGE_LABEL_KEY = {
  contact: "candidates.stageContact",
  interview: "candidates.stageInterview",
  intake: "candidates.stageIntake",
  archived: "candidates.stageArchived",
} as const;

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
  // full screen (cache already warm) paints the counts immediately, no skeleton flash.
  const { candidates, isLoading: loading, isError: error } = useCandidatesList();

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
            on error (the body carries the message), the candidate count otherwise. */}
        {loading ? (
          <span className={`h-4 w-20 ${SKELETON}`} aria-hidden="true" />
        ) : error ? null : (
          <span className={`type-label ${candidates.length > 0 ? "text-ink" : "text-muted"}`}>
            {candidates.length > 0
              ? `${candidates.length} ${t("candidates.candidateCount")}`
              : t("candidates.emptyBadge")}
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
        <p className="type-label text-muted">{t("candidates.loadFailed")}</p>
      ) : candidates.length > 0 ? (
        // The pipeline at a glance: one row per stage with its count. A fixed four
        // rows (zeros muted) so the card keeps a stable height like the other
        // preview cards — the pipeline SHAPE is the summary, not the row list.
        <ul className="flex flex-col divide-y divide-hairline">
          {CANDIDATE_STAGES.map((stage) => {
            const count = candidates.filter((it) => it.stage === stage).length;
            return (
              <li key={stage} className="flex items-center justify-between py-sm">
                <span className={`type-body ${count > 0 ? "text-ink" : "text-muted"}`}>
                  {t(STAGE_LABEL_KEY[stage])}
                </span>
                <span className={`type-label ${count > 0 ? "text-app-blue" : "text-muted"}`}>
                  {count}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="type-label text-muted">{t("candidates.emptyBody")}</p>
      )}
    </div>
  );
}
