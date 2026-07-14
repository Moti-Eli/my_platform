"use client";

/**
 * Inventory dashboard card (Standard §2 `views/DashboardCard.tsx`, §8).
 *
 * A compact summary for Home: the tool name, a low-stock count, and the low
 * items. Built from the design-system utilities (amber accent from the palette)
 * and i18n only — no hard-coded colors or text. Reads its data through the one
 * door (`runIntent('inventory.query_stock')`).
 */
import { useEffect, useState } from "react";
import { getRuntime } from "@/cortex/runtime";
import { DEV_CTX } from "@/cortex/dev-ctx";
import { useI18n } from "@/i18n";
import { BoxIcon } from "@/components/icons";
import type { InventoryItem } from "../logic";

/** Cap on preview rows so the Home card stays a fixed height (matching the other
 * preview cards) no matter how many items are low — the header count still shows
 * the real total. */
const MAX_PREVIEW_ROWS = 4;

export function DashboardCard() {
  const { t } = useI18n();
  const [items, setItems] = useState<InventoryItem[]>([]);

  useEffect(() => {
    let alive = true;
    getRuntime()
      .then((rt) => rt.runIntent<InventoryItem[]>("inventory.query_stock", {}, DEV_CTX))
      .then((list) => {
        if (alive) setItems(list);
      });
    return () => {
      alive = false;
    };
  }, []);

  const low = items.filter((item) => item.quantity < item.reorderThreshold);

  return (
    <div className="rounded-xl bg-card p-4 shadow-soft">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber/15 text-amber">
            <BoxIcon width={20} height={20} />
          </span>
          <span className="text-sm font-bold text-ink">{t("inventory.name")}</span>
        </div>
        <span className={`text-sm font-semibold ${low.length > 0 ? "text-amber" : "text-muted"}`}>
          {low.length > 0 ? `${low.length} ${t("inventory.lowItems")}` : t("inventory.allStocked")}
        </span>
      </div>

      {low.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {low.slice(0, MAX_PREVIEW_ROWS).map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between rounded-lg bg-screen px-3 py-2"
            >
              <span className="text-sm text-ink">{item.name}</span>
              <span className="text-xs text-muted" dir="ltr">
                {item.quantity} {item.unit}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
