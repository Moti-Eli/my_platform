"use client";

/**
 * Shopping dashboard card (Standard §2 `views/DashboardCard.tsx`, §8), on the
 * app-amber identity accent, same chrome and fixed height (~1/3 of the visible
 * viewport, from `--app-vh`) as the orders card.
 *
 * "My lists" in small (stage 2, decision 5A) — the same read as the tool's main
 * screen, so it looks the same in EVERY org the tool is on, not only in a list
 * org:
 *   - up to MAX_ROWS lists, the ones with the most left to buy first (then by
 *     name), each with how many items are left; a row opens that list in place
 *   - more lists than that → "and N more" (tapping the card opens "My lists")
 *   - no lists → an explicit line
 *   - ＋ → the same NewListModal as the full screen; then the new list opens
 *   - each row starts with the user's type colour, while types are available
 *
 * STATES, MODELLED EXPLICITLY: loading → skeleton; error → a muted "couldn't
 * load" line, never silently blank.
 *
 * TAPS: Home wraps this card in a `<Link>` to the tool. ＋ and each row call BOTH
 * `preventDefault` (what stops the ancestor `<a>`) and `stopPropagation`, and
 * navigate themselves. The modal is PORTALLED to <body> so its clicks are not
 * inside the `<a>` in the DOM, and wrapped in a stopPropagation so React's
 * synthetic bubbling (which follows the React tree through a portal) never
 * reaches the Link's onClick either.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { CheckIcon, PlusIcon } from "@/components/icons";
import { useShoppingLists } from "@/lib/query/useShoppingList";
import { useShoppingTypes } from "@/lib/query/useShoppingTypes";
import type { ListSummary } from "../logic";
import { listHref } from "../nav";
import { NewListModal } from "./NewListModal";
import { TypeDot } from "./TypeViews";
import { SKELETON } from "./shared";

/** How many lists the card shows. */
const MAX_ROWS = 4;

/** Most left to buy first; ties keep the hook's A–Z order (sort is stable). */
function forCard(lists: readonly ListSummary[]): ListSummary[] {
  return [...lists].sort((a, b) => b.toBuy - a.toBuy);
}

// userId/orgId arrive as props but are never sent anywhere: the server action
// derives identity from the session cookie.
export function DashboardCard(_props: ToolViewProps) {
  const { t } = useI18n();
  const router = useRouter();
  const { lists, isLoading, isError } = useShoppingLists();
  const typesQ = useShoppingTypes();
  const [creating, setCreating] = useState(false);

  const shown = forCard(lists).slice(0, MAX_ROWS);
  const more = lists.length - shown.length;

  return (
    <div
      className="flex flex-col rounded-lg bg-card p-md"
      style={{ height: "calc(var(--app-vh, 100dvh) / 3)" }}
    >
      <div className="mb-sm flex shrink-0 items-center justify-between gap-xs">
        <div className="flex min-w-0 items-center gap-xs">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-app-amber/15 text-app-amber">
            <CheckIcon width={20} height={20} />
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate type-label text-muted">{t("shopping.name")}</span>
            <span className="truncate type-heading text-ink">{t("shopping.myListsTitle")}</span>
          </div>
        </div>
        <button
          type="button"
          aria-label={t("shopping.newList")}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setCreating(true);
          }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-app-amber text-on-fill interactive motion-safe:active:scale-[0.97]"
        >
          <PlusIcon width={16} height={16} />
        </button>
      </div>

      {/* The scrolling region — the only part that grows past the fixed height. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <ul className="flex flex-col divide-y divide-hairline" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="py-sm">
                <span className={`block h-4 w-32 ${SKELETON}`} />
              </li>
            ))}
          </ul>
        ) : isError ? (
          <p className="type-label text-muted">{t("shopping.loadFailed")}</p>
        ) : lists.length === 0 ? (
          <p className="type-label text-muted">{t("shopping.noListsTitle")}</p>
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-hairline">
              {shown.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      router.push(listHref(l.id));
                    }}
                    className="flex w-full items-center justify-between gap-sm py-xs text-start interactive"
                  >
                    {/* The user's type colour (only while types are available). */}
                    {typesQ.available ? <TypeDot color={typesQ.typeOf(l.id)?.color ?? null} /> : null}
                    <span className="min-w-0 flex-1 truncate type-body text-ink">{l.name}</span>
                    <span
                      className={`shrink-0 type-label ${l.toBuy > 0 ? "text-app-amber" : "text-muted"}`}
                    >
                      {l.total === 0
                        ? t("shopping.listEmpty")
                        : l.toBuy === 0
                          ? t("shopping.allBought")
                          : t("shopping.toBuyShort").replace("{count}", String(l.toBuy))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {more > 0 ? (
              <p className="pt-2xs type-caption text-muted">
                {more === 1
                  ? t("shopping.moreListsOne")
                  : t("shopping.moreListsMany").replace("{count}", String(more))}
              </p>
            ) : null}
          </>
        )}
      </div>

      {creating && typeof document !== "undefined"
        ? createPortal(
            <div
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              className="contents"
            >
              <NewListModal
                onClose={() => setCreating(false)}
                onCreated={(id) => router.push(listHref(id))}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
