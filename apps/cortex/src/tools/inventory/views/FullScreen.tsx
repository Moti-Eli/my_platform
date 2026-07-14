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
import { useCallback, useEffect, useState } from "react";
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

  const refresh = useCallback(async () => {
    const rt = await getRuntime();
    setItems(await rt.runIntent<InventoryItem[]>("inventory.query_stock", {}, DEV_CTX));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const changeQuantity = useCallback(
    async (product: string, delta: number) => {
      const rt = await getRuntime();
      await rt.runIntent("inventory.update_quantity", { product, delta }, DEV_CTX);
      await refresh();
    },
    [refresh],
  );

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label={t("common.back")}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-ink shadow-soft transition active:scale-95"
        >
          <ChevronIcon style={{ transform: dir === "rtl" ? "scaleX(-1)" : undefined }} />
        </button>
        <h1 className="flex-1 text-xl font-bold text-ink">{t("inventory.name")}</h1>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="rounded-pill bg-amber px-4 py-2 text-sm font-semibold text-white shadow-soft transition active:scale-95"
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
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl bg-card px-6 py-14 text-center shadow-soft">
          <p className="text-base font-semibold text-ink">{t("inventory.emptyTitle")}</p>
          <p className="max-w-[24ch] text-sm text-muted">{t("inventory.emptyHint")}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => {
            const low = item.quantity < item.reorderThreshold;
            return (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-xl bg-card px-4 py-3 shadow-soft"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-2 truncate text-sm font-semibold text-ink">
                    {item.name}
                    {low ? (
                      <span className="rounded-pill bg-amber/15 px-2 py-0.5 text-[11px] font-semibold text-amber">
                        {t("inventory.lowBadge")}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted" dir="ltr">
                    {item.quantity} {item.unit}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-label={t("inventory.decrease")}
                    onClick={() => changeQuantity(item.name, -1)}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-screen text-ink transition active:scale-90"
                  >
                    <MinusIcon width={18} height={18} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("inventory.increase")}
                    onClick={() => changeQuantity(item.name, 1)}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-screen text-ink transition active:scale-90"
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
    "w-full rounded-lg bg-screen px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !unit.trim()) return;
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
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-soft">
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        {t("inventory.productName")}
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          {t("inventory.quantity")}
          <input
            className={inputClass}
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          {t("inventory.unit")}
          <input className={inputClass} value={unit} onChange={(e) => setUnit(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
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
        className="rounded-lg bg-amber py-2.5 text-sm font-semibold text-white shadow-soft transition active:scale-[0.99]"
      >
        {t("inventory.add")}
      </button>
    </form>
  );
}
