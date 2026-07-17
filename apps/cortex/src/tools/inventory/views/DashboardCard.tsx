"use client";

/**
 * Inventory dashboard card (Standard §2 `views/DashboardCard.tsx`, §8).
 *
 * A compact summary for Home: the tool name, a low-stock count, and the low
 * items. Built from the design-system utilities (amber accent from the palette)
 * and i18n only — no hard-coded colors or text.
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

// The page passes userId/orgId (it called requireSession()), but this view does
// NOT send them anywhere: the server action derives identity from the session
// cookie, never from a client-supplied value — that is the whole defence. They
// stay in the prop TYPE only because the page provides them; `_props` marks them
// deliberately unused here.
export function DashboardCard(_props: ToolViewProps) {
  const { t } = useI18n();
  const [items, setItems] = useState<InventoryItem[]>([]);

  useEffect(() => {
    let alive = true;
    // No ctx argument — the server builds it. We send only the intent + input.
    runIntentAction("inventory.query_stock", {})
      .then((res) => {
        if (!alive) return;
        if (res.ok) setItems(res.data as InventoryItem[]);
        else console.error("Cortex: inventory dashboard card failed to load", res.code);
      })
      .catch((err: unknown) => {
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
        <span className={`type-label ${low.length > 0 ? "text-warning" : "text-muted"}`}>
          {low.length > 0 ? `${low.length} ${t("inventory.lowItems")}` : t("inventory.allStocked")}
        </span>
      </div>

      {low.length > 0 ? (
        <ul className="flex flex-col divide-y divide-hairline">
          {low.slice(0, MAX_PREVIEW_ROWS).map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between py-sm"
            >
              <span className="type-body text-ink">{item.name}</span>
              <span className="type-label text-muted" dir="ltr">
                {item.quantity} {item.unit}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
