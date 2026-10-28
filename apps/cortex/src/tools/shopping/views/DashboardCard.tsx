"use client";

/**
 * Shopping dashboard card (Standard §2 `views/DashboardCard.tsx`, §8), on the
 * app-amber identity accent, same chrome and fixed height (~1/3 of the visible
 * viewport, from `--app-vh`) as the orders card.
 *
 * Every list lives in its own org (ARCHITECTURE.md #38), so the card depends on
 * the ACTIVE org:
 *   - a list org    → the list's name, how many items are left to buy, and those
 *                     items (scrolling inside the card). Tapping opens the list.
 *   - any other org → "New list", which opens the same NewListModal as the full
 *                     screen.
 *
 * STATES, MODELLED EXPLICITLY: loading → skeleton; error → a muted "couldn't
 * load" line, never silently blank. Reads the SAME shared caches as the full
 * screen, so the card and the tool never disagree.
 *
 * TAPS: Home wraps this card in a `<Link>` to the tool. The "New list" button
 * calls BOTH `preventDefault` (what stops the ancestor `<a>`) and
 * `stopPropagation`. The modal is PORTALLED to <body> so its clicks are not
 * inside the `<a>` in the DOM, and wrapped in a stopPropagation so React's
 * synthetic bubbling (which follows the React tree through a portal) never
 * reaches the Link's onClick either.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { CheckIcon, PlusIcon } from "@/components/icons";
import { useShoppingList } from "@/lib/query/useShoppingList";
import { useShoppingItems } from "@/lib/query/useShoppingItems";
import { NewListModal } from "./NewListModal";
import { SKELETON } from "./shared";

// userId/orgId arrive as props but are never sent anywhere: the server action
// derives identity from the session cookie.
export function DashboardCard(_props: ToolViewProps) {
  const { t } = useI18n();
  const listQ = useShoppingList();
  const list = listQ.list;
  const [creating, setCreating] = useState(false);

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
            {list ? (
              <span className="truncate type-label text-muted">{t("shopping.name")}</span>
            ) : null}
            <span className="truncate type-heading text-ink">
              {list ? list.name : t("shopping.name")}
            </span>
          </div>
        </div>
        {!listQ.isLoading && !listQ.isError && !list ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setCreating(true);
            }}
            className="flex shrink-0 items-center gap-2xs rounded-pill bg-app-amber px-sm py-xs type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
          >
            <PlusIcon width={14} height={14} aria-hidden />
            {t("shopping.newList")}
          </button>
        ) : null}
      </div>

      {/* The scrolling region — the only part that grows past the fixed height. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {listQ.isLoading ? (
          <span className={`block h-4 w-32 ${SKELETON}`} aria-hidden="true" />
        ) : listQ.isError ? (
          <p className="type-label text-muted">{t("shopping.loadFailed")}</p>
        ) : list ? (
          <ToBuy />
        ) : (
          <p className="type-label text-muted">{t("shopping.noListTitle")}</p>
        )}
      </div>

      {creating && typeof document !== "undefined"
        ? createPortal(
            <div
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              className="contents"
            >
              <NewListModal onClose={() => setCreating(false)} />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/** "N left to buy" + those items. Only mounted in a list org. */
function ToBuy() {
  const { t } = useI18n();
  const { toBuy, isLoading, isError } = useShoppingItems();

  if (isLoading) {
    return (
      <ul className="flex flex-col divide-y divide-hairline" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <li key={i} className="py-sm">
            <span className={`block h-4 w-28 ${SKELETON}`} />
          </li>
        ))}
      </ul>
    );
  }
  if (isError) return <p className="type-label text-muted">{t("shopping.loadFailed")}</p>;
  if (toBuy.length === 0) {
    return <p className="type-label text-muted">{t("shopping.nothingLeft")}</p>;
  }

  return (
    <>
      <p className="pb-2xs type-label text-ink">
        {toBuy.length === 1
          ? t("shopping.leftToBuyOne")
          : t("shopping.leftToBuyMany").replace("{count}", String(toBuy.length))}
      </p>
      <ul className="flex flex-col divide-y divide-hairline">
        {toBuy.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-sm py-xs">
            <span className="min-w-0 flex-1 truncate type-body text-ink">{item.name}</span>
            {item.quantity ? (
              <span className="shrink-0 type-label text-muted">{item.quantity}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
