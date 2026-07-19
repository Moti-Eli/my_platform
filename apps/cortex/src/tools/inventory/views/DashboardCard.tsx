"use client";

/**
 * Inventory dashboard card (Standard §2 `views/DashboardCard.tsx`, §8).
 *
 * A compact summary for Home: the tool name, a low-stock count, and the low
 * items. Built from the design-system utilities (amber accent from the palette)
 * and i18n only — no hard-coded colors or text.
 *
 * THREE STATES, MODELLED EXPLICITLY (this card is the template the next tool's
 * card is cloned from, so the states must be clean):
 *   - loading         → a skeleton (header as-is + placeholder rows), never a
 *                        flash of empty. The card mounts with loading=true, so the
 *                        first paint is the skeleton, not a blank body.
 *   - loaded, low      → the low-stock list, as before.
 *   - loaded, none low → an explicit "all stocked" body, not a blank card.
 *   - error            → a short muted "couldn't load" line, never silently blank.
 *
 * Reads through the SERVER action (`runIntentAction`), not a client runtime: the
 * grants revoked client writes on every Cortex table, and reads must carry the
 * user's JWT so `auth_user_can_read` runs. The action builds ctx from the session.
 */
import { useEffect, useState } from "react";
import { runIntentAction } from "@/cortex/actions";
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { BoxIcon } from "@/components/icons";
import type { InventoryItem } from "../logic";

/** Cap on preview rows so the Home card stays a fixed height (matching the other
 * preview cards) no matter how many items are low — the header count still shows
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
  const [items, setItems] = useState<InventoryItem[]>([]);
  // Starts true so the first paint is the skeleton, not an empty body. Cleared
  // once the request settles — on success AND on failure.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    // No ctx argument — the server builds it. We send only the intent + input.
    runIntentAction("inventory.query_stock", {})
      .then((res) => {
        if (!alive) return;
        if (res.ok) setItems(res.data as InventoryItem[]);
        else {
          setError(true);
          console.error("Cortex: inventory dashboard card failed to load", res.code);
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(true);
        setLoading(false);
        console.error("Cortex: inventory dashboard card failed to load", err);
      });
    return () => {
      alive = false;
    };
  }, []);

  const low = items.filter((item) => item.quantity < item.reorderThreshold);

  return (
    <div className="rounded-lg bg-card p-md">
      <div className="mb-sm flex items-center justify-between">
        <div className="flex items-center gap-xs">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-app-amber/15 text-app-amber">
            <BoxIcon width={20} height={20} />
          </span>
          <span className="type-heading text-ink">{t("inventory.name")}</span>
        </div>
        {/* Status: a skeleton while loading (we don't know the count yet), nothing
            on error (the body carries the message), the real count otherwise. */}
        {loading ? (
          <span className={`h-4 w-20 ${SKELETON}`} aria-hidden="true" />
        ) : error ? null : (
          <span className={`type-label ${low.length > 0 ? "text-warning" : "text-muted"}`}>
            {low.length > 0 ? `${low.length} ${t("inventory.lowItems")}` : t("inventory.allStocked")}
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
        <p className="type-label text-muted">{t("inventory.loadFailed")}</p>
      ) : items.length > 0 ? (
        <ul className="flex flex-col divide-y divide-hairline">
          {items.slice(0, MAX_PREVIEW_ROWS).map((item) => {
            // Low stock is now a per-row SIGNAL, not a gate: the row renders
            // either way, and only wears the badge when it's below threshold.
            const isLow = item.quantity < item.reorderThreshold;
            return (
              <li
                key={item.id}
                className="flex items-center justify-between py-sm"
              >
                <span className="flex items-center gap-xs type-body text-ink">
                  {item.name}
                  {isLow ? (
                    <span className="rounded-pill bg-warning/15 px-xs py-2xs type-caption text-warning">
                      {t("inventory.lowBadge")}
                    </span>
                  ) : null}
                </span>
                <span className="type-label text-muted" dir="ltr">
                  {item.quantity} {item.unit}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="type-label text-muted">{t("inventory.allStockedBody")}</p>
      )}
    </div>
  );
}
