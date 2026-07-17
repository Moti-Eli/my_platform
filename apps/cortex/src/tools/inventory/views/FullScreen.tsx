"use client";

/**
 * Inventory full screen (Standard §2 `views/FullScreen.tsx`, §8).
 *
 * Product list with per-item quantity + inline +/- update, and an add-product
 * action. Reads go through the SERVER action (`runIntentAction`) so RLS runs and
 * the audit row is written server-side; the action builds ctx from the session,
 * so no identity is sent from here.
 *
 * WRITES ARE NOT AVAILABLE YET. `authenticated` holds no INSERT/UPDATE on
 * inventory_items (20260717000001/2), so add-product and quantity-change are
 * denied at the database. That is intended for this step — the write path is a
 * later design decision — so those failures degrade to a translated "not
 * available yet" notice rather than pretending to succeed. Built from
 * design-system utilities + i18n only.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { runIntentAction } from "@/cortex/actions";
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { ChevronIcon, PlusIcon, MinusIcon } from "@/components/icons";
import type { InventoryItem } from "../logic";

// userId/orgId arrive as props (the page called requireSession()) but are NOT
// sent to the action — the server derives identity from the session cookie. They
// stay in the prop type only because the page provides them; `_props` marks them
// deliberately unused.
export function FullScreen(_props: ToolViewProps) {
  const { t, dir } = useI18n();
  const router = useRouter();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [adding, setAdding] = useState(false);
  // Set when a write is denied by grants (the expected state until the write path
  // lands). Surfaced as a translated notice, never a silent no-op.
  const [writeUnavailable, setWriteUnavailable] = useState(false);
  // Guard the async setState (mirrors DashboardCard's `alive` flag): `refresh`
  // resolves after an await and is also called from handlers, so a navigation
  // away before it settles must not write state on an unmounted component.
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);

  const refresh = useCallback(async () => {
    // No ctx argument — the server builds it from the session.
    const res = await runIntentAction("inventory.query_stock", {});
    if (!mounted.current) return;
    if (res.ok) setItems(res.data as InventoryItem[]);
    // The effect below fires this without awaiting, so a rejection here would
    // otherwise vanish and leave the screen blank with no trace.
    else console.error("Cortex: inventory list failed to load", res.code);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const changeQuantity = useCallback(
    async (product: string, delta: number) => {
      const res = await runIntentAction("inventory.update_quantity", { product, delta });
      if (!mounted.current) return;
      if (res.ok) {
        await refresh();
      } else {
        // Denied by grants (write path not built yet) — say so, don't fake it.
        setWriteUnavailable(true);
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

      {writeUnavailable ? (
        <p role="alert" className="rounded-md bg-warning/10 px-sm py-xs type-label text-warning">
          {t("inventory.writeUnavailable")}
        </p>
      ) : null}

      {adding ? (
        <AddProductForm
          onWriteUnavailable={() => setWriteUnavailable(true)}
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

function AddProductForm({
  onDone,
  onWriteUnavailable,
}: {
  onDone: () => void | Promise<void>;
  onWriteUnavailable: () => void;
}) {
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
    // No ctx argument — the server builds it from the session.
    const res = await runIntentAction("inventory.add_product", {
      name: name.trim(),
      quantity: Number(quantity) || 0,
      unit: unit.trim(),
      reorderThreshold: Number(threshold) || 0,
    });
    if (res.ok) await onDone();
    // Denied by grants (write path not built yet) — surface it, don't swallow.
    else onWriteUnavailable();
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
