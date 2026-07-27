"use client";

/**
 * Questionnaire dashboard card (Standard §2 `views/DashboardCard.tsx`, §8). Cloned
 * from Time-entries' card, on the app-blue identity accent.
 *
 * FOUR STATES, MODELLED EXPLICITLY:
 *   - loading             → a skeleton (never a flash of empty).
 *   - loaded, has rows    → the count of questions + how many are answered, and a
 *                           short preview of the questions (✓ when answered).
 *   - loaded, no rows     → an explicit "no questionnaire here" body.
 *   - error               → a short muted "couldn't load" line, never silently blank.
 *
 * Reads through the SHARED react-query cache (`useQuestionnaireList`, queryKey
 * ["questionnaire","list"]) — the SAME cache the full screen uses, so opening it
 * paints instantly and revalidates in the background. The fetch is the SERVER action
 * (`runIntentAction`), which builds ctx from the session, so the client carries no
 * identity. Tapping the card opens the tool (the Home shell owns that navigation).
 */
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { CheckIcon, DocumentIcon } from "@/components/icons";
import { useQuestionnaireList } from "@/lib/query/useQuestionnaireList";

/** Cap on preview rows so the Home card stays a fixed height regardless of how many
 * questions there are — the header count still shows the real total. */
const MAX_PREVIEW_ROWS = 4;

/** Muted placeholder block. `motion-safe:animate-pulse` so reduced-motion users get
 * a static (still visible) skeleton, not a pulse. */
const SKELETON = "rounded-md bg-hairline motion-safe:animate-pulse";

// The page passes userId/orgId (it called requireSession()), but this view does NOT
// send them anywhere: the server action derives identity from the session cookie.
// They stay in the prop TYPE only because the page provides them; `_props` marks
// them deliberately unused here.
export function DashboardCard(_props: ToolViewProps) {
  const { t } = useI18n();
  const { rows, isLoading: loading, isError: error } = useQuestionnaireList();
  const total = rows.length;
  const answered = rows.filter((r) => r.answer.trim() !== "").length;

  return (
    <div className="rounded-lg bg-card p-md">
      <div className="mb-sm flex items-center justify-between">
        <div className="flex items-center gap-xs">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-app-blue/15 text-app-blue">
            <DocumentIcon width={20} height={20} />
          </span>
          <span className="type-heading text-ink">{t("questionnaire.name")}</span>
        </div>
        {/* Status: a skeleton while loading, nothing on error (the body carries the
            message), else the question count (or the empty badge). */}
        {loading ? (
          <span className={`h-4 w-20 ${SKELETON}`} aria-hidden="true" />
        ) : error ? null : (
          <span className={`type-label ${total > 0 ? "text-ink" : "text-muted"}`}>
            {total > 0
              ? `${total} ${t("questionnaire.questionCount")}`
              : t("questionnaire.emptyBadge")}
          </span>
        )}
      </div>

      {loading ? (
        <ul className="flex flex-col divide-y divide-hairline" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center justify-between py-sm">
              <span className={`h-4 w-40 ${SKELETON}`} />
              <span className={`h-4 w-6 ${SKELETON}`} />
            </li>
          ))}
        </ul>
      ) : error ? (
        <p className="type-label text-muted">{t("questionnaire.loadFailed")}</p>
      ) : total > 0 ? (
        <>
          {/* How many answered — the headline metric. */}
          <p className="mb-xs type-label text-muted">
            <span className="text-ink" dir="ltr">
              {answered}/{total}
            </span>{" "}
            {t("questionnaire.answeredCount")}
          </p>
          <ul className="flex flex-col divide-y divide-hairline">
            {rows.slice(0, MAX_PREVIEW_ROWS).map((row) => {
              const isAnswered = row.answer.trim() !== "";
              return (
                <li key={row.id} className="flex items-center justify-between gap-sm py-sm">
                  <span className="min-w-0 truncate type-body text-ink">{row.questionText}</span>
                  {isAnswered ? (
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success"
                      aria-hidden="true"
                    >
                      <CheckIcon width={12} height={12} />
                    </span>
                  ) : (
                    <span className="h-5 w-5 shrink-0 rounded-full border border-hairline" aria-hidden="true" />
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="type-label text-muted">{t("questionnaire.emptyBody")}</p>
      )}
    </div>
  );
}
