"use client";

/**
 * Inventory full screen (Standard §2 `views/FullScreen.tsx`, §8).
 *
 * Product list with per-item quantity + inline +/- update, and an add-product
 * action. Every read/write goes through the one door (`runIntent`); updating a
 * quantity below its threshold triggers the `inventory.low` event inside the
 * logic. Built from design-system utilities + i18n only — no hard-coded colors
 * or text.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getRuntime } from "@/cortex/runtime";
import { DEV_CTX } from "@/cortex/dev-ctx";
import { useI18n } from "@/i18n";
import { ChevronIcon, PlusIcon, MinusIcon } from "@/components/icons";
import type { InventoryItem } from "../logic";

export function FullScreen() {
  const { t, dir } = useI18n();
  const router = useRouter();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [adding, setAdding] = useState(false);
  // Guard the async setState (mirrors DashboardCard's `alive` flag): `refresh`
  // resolves after an await and is also called from handlers, so a navigation
  // away before it settles must not write state on an unmounted component.
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);

  const refresh = useCallback(async () => {
    try {
      const rt = await getRuntime();
      const list = await rt.runIntent<InventoryItem[]>("inventory.query_stock", {}, DEV_CTX);
      if (mounted.current) setItems(list);
    } catch (err) {
      // The effect below fires this without awaiting, so a rejection here would
      // otherwise vanish and leave the screen blank with no trace.
      console.error("Cortex: inventory list failed to load", err);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const changeQuantity = useCallback(
    async (product: string, delta: number) => {
      try {
        const rt = await getRuntime();
        await rt.runIntent("inventory.update_quantity", { product, delta }, DEV_CTX);
        await refresh();
      } catch (err) {
        console.error("Cortex: inventory quantity update failed", err);
      }
    },
    [refresh],
  );

  return (
    <>
      <div className="flex items-center gap-xs">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label={t("common.back")}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-ink interactive motion-safe:active:scale-[0.97]"
        >
          <ChevronIcon style={{ transform: dir === "rtl" ? "scaleX(-1)" : undefined }} />
        </button>
        <h1 className="flex-1 type-title text-ink">{t("inventory.name")}</h1>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="rounded-pill bg-app-amber px-md py-xs type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
        >
          {t("inventory.addProduct")}
        </button>
      </div>

      {adding ? (
        <AddProductForm
          onDone={async () => {
            setAdding(false);
            await refresh();
          }}
        />
      ) : null}

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-xs rounded-lg bg-card px-lg py-2xl text-center">
          <p className="type-heading text-ink">{t("inventory.emptyTitle")}</p>
          <p className="max-w-[24ch] type-label text-muted">{t("inventory.emptyHint")}</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline">
          {items.map((item) => {
            const low = item.quantity < item.reorderThreshold;
            return (
              <li
                key={item.id}
                className="flex items-center justify-between gap-sm py-sm"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-xs truncate type-heading text-ink">
                    {item.name}
                    {low ? (
                      <span className="rounded-pill bg-warning/15 px-xs py-2xs type-caption text-warning">
                        {t("inventory.lowBadge")}
                      </span>
                    ) : null}
                  </span>
                  <span className="type-label text-muted" dir="ltr">
                    {item.quantity} {item.unit}
                  </span>
                </div>

                <div className="flex items-center gap-xs">
                  <button
                    type="button"
                    aria-label={t("inventory.decrease")}
                    onClick={() => changeQuantity(item.name, -1)}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-hairline text-ink interactive motion-safe:active:scale-[0.97]"
                  >
                    <MinusIcon width={18} height={18} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("inventory.increase")}
                    onClick={() => changeQuantity(item.name, 1)}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-hairline text-ink interactive motion-safe:active:scale-[0.97]"
                  >
                    <PlusIcon width={18} height={18} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function AddProductForm({ onDone }: { onDone: () => void | Promise<void> }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("0");
  const [unit, setUnit] = useState("");
  const [threshold, setThreshold] = useState("0");

  const inputClass =
    "w-full rounded-md bg-screen px-sm py-sm type-body text-ink outline-none placeholder:text-muted";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !unit.trim()) return;
    try {
      const rt = await getRuntime();
      await rt.runIntent(
        "inventory.add_product",
        {
          name: name.trim(),
          quantity: Number(quantity) || 0,
          unit: unit.trim(),
          reorderThreshold: Number(threshold) || 0,
        },
        DEV_CTX,
      );
      await onDone();
    } catch (err) {
      console.error("Cortex: add product failed", err);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-sm rounded-lg bg-card p-md">
      <label className="flex flex-col gap-2xs type-label text-muted">
        {t("inventory.productName")}
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="grid grid-cols-3 gap-xs">
        <label className="flex flex-col gap-2xs type-label text-muted">
          {t("inventory.quantity")}
          <input
            className={inputClass}
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-2xs type-label text-muted">
          {t("inventory.unit")}
          <input className={inputClass} value={unit} onChange={(e) => setUnit(e.target.value)} />
        </label>
        <label className="flex flex-col gap-2xs type-label text-muted">
          {t("inventory.threshold")}
          <input
            className={inputClass}
            inputMode="numeric"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </label>
      </div>
      <button
        type="submit"
        className="rounded-md bg-app-amber py-sm type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
      >
        {t("inventory.add")}
      </button>
    </form>
  );
}
