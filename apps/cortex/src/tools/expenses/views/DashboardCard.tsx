"use client";

/**
 * Expenses dashboard card (Standard §2 `views/DashboardCard.tsx`, §8). Cloned from
 * Notes' card, on the app-green identity accent.
 *
 * THREE STATES, MODELLED EXPLICITLY:
 *   - loading               → a skeleton (header as-is + placeholder rows), never a
 *                             flash of empty.
 *   - loaded, has expenses  → the running TOTAL as the headline number + the first
 *                             few expenses (amount + category).
 *   - loaded, no expenses   → an explicit "nothing here yet" body, not a blank card.
 *   - error                 → a short muted "couldn't load" line, never silently blank.
 *
 * Reads through the SHARED react-query cache (`useExpensesList`, queryKey
 * ["expenses","list"]) — the SAME cache the full screen uses, so opening the full
 * screen paints instantly from cache and revalidates in the background. The query's
 * fetch is still the SERVER action (`runIntentAction`), which builds ctx from the
 * session, so every fetch (including a background refetch) is re-authenticated; the
 * client never carries identity.
 */
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { WalletIcon } from "@/components/icons";
import { useExpensesList } from "@/lib/query/useExpensesList";
import { formatAmount } from "@/tools/expenses/logic";

/** Cap on preview rows so the Home card stays a fixed height (matching the other
 * preview cards) no matter how many expenses there are — the header total still
 * reflects every row. */
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
  const { expenses, isLoading: loading, isError: error } = useExpensesList();

  // The headline number: the sum of every expense in the org (not just the preview).
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);

  return (
    <div className="rounded-lg bg-card p-md">
      <div className="mb-sm flex items-center justify-between">
        <div className="flex items-center gap-xs">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-app-green/15 text-app-green">
            <WalletIcon width={20} height={20} />
          </span>
          <span className="type-heading text-ink">{t("expenses.name")}</span>
        </div>
        {/* Status: a skeleton while loading (we don't know the total yet), nothing
            on error (the body carries the message), the running total otherwise. */}
        {loading ? (
          <span className={`h-4 w-20 ${SKELETON}`} aria-hidden="true" />
        ) : error ? null : expenses.length > 0 ? (
          <span className="type-label text-ink" dir="ltr">
            {formatAmount(total)}
          </span>
        ) : (
          <span className="type-label text-muted">{t("expenses.emptyBadge")}</span>
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
        <p className="type-label text-muted">{t("expenses.loadFailed")}</p>
      ) : expenses.length > 0 ? (
        <ul className="flex flex-col divide-y divide-hairline">
          {expenses.slice(0, MAX_PREVIEW_ROWS).map((expense) => (
            <li key={expense.id} className="flex items-center justify-between gap-sm py-sm">
              <span className="flex min-w-0 items-center gap-xs type-body">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-app-green/15 text-app-green">
                  <WalletIcon width={14} height={14} />
                </span>
                <span className="truncate text-muted">{expense.category}</span>
              </span>
              <span className="shrink-0 type-label text-ink" dir="ltr">
                {formatAmount(expense.amount)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="type-label text-muted">{t("expenses.emptyBody")}</p>
      )}
    </div>
  );
}
