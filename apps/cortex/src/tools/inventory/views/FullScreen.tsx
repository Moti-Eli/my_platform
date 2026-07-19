"use client";

/**
 * Inventory full screen (Standard §2 `views/FullScreen.tsx`, §8).
 *
 * Product list with per-item quantity + inline +/- update, and an add-product
 * action. The read is the SHARED react-query cache (`useInventoryStock`, queryKey
 * ["inventory","stock"]) — the same entry the dashboard card reads — so this screen
 * renders from cache and each write reconciles that cache via setQueryData (no
 * refetch). Writes still go straight through the SERVER action (`runIntentAction`);
 * every call — read or write — builds ctx from the session, so no identity is sent
 * from here.
 *
 * WRITES WORK (20260717000005 opened the path). `authenticated` now holds
 * INSERT/UPDATE on inventory_items, and a write flows runIntentAction -> the server
 * data-layer -> the RLS client, where it is gated ROW BY ROW by
 * `private.auth_user_can_write`: membership in the row's org tree is the gate. A
 * write can therefore genuinely succeed — so this screen updates OPTIMISTICALLY and
 * reconciles to the server's authoritative answer — or genuinely fail, in which case
 * the failure is a real one (a denial, or something broken) and is surfaced honestly,
 * never faked and never swallowed.
 *
 * Built from design-system utilities + i18n only.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { runIntentAction, type IntentResult } from "@/cortex/actions";
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { ChevronIcon, PlusIcon, MinusIcon, InfoIcon } from "@/components/icons";
import type { InventoryItem } from "../logic";
import { useInventoryStock, INVENTORY_STOCK_KEY } from "@/lib/query/useInventoryStock";

/** The failure codes a write can come back with (from {@link IntentResult}). */
type WriteErrorCode = Extract<IntentResult, { ok: false }>["code"];

// userId/orgId arrive as props (the page called requireSession()) but are NOT
// sent to the action — the server derives identity from the session cookie. They
// stay in the prop type only because the page provides them; `_props` marks them
// deliberately unused.
export function FullScreen(_props: ToolViewProps) {
  const { t, dir } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  // The READ: straight from the shared query cache — this screen is a reader of the
  // SAME entry the dashboard card reads. It renders from the cache (the single
  // source of truth) and writes back into it via setQueryData, so the two views can
  // never hold diverging copies. Arriving from the card, the cache is warm and the
  // list paints instantly; react-query revalidates in the background.
  const { items } = useInventoryStock();
  const [adding, setAdding] = useState(false);
  // Set when a write actually FAILS. Distinguishes the honest cases: "denied" /
  // "unavailable" (the DB refused — you may not) vs "failed" (something broke).
  // Never a silent no-op, and never a pretend-success.
  const [writeError, setWriteError] = useState<WriteErrorCode | null>(null);
  // Guards the async setState in the WRITE callbacks below: they resolve after an
  // await, so a navigation away before they settle must not set component state on
  // an unmounted component. (Cache writes via queryClient are safe either way — and
  // are intentionally NOT gated on this, so a write still reconciles the shared
  // cache even if this screen has since unmounted.)
  const mounted = useRef(true);
  useEffect(() => {
    // Re-arm on every (re)mount. Under StrictMode React runs mount → cleanup →
    // mount; setting `true` here (not only `false` in cleanup) means the second
    // mount re-enables the guard instead of leaving it permanently disarmed,
    // which would swallow every later setState and strand the view empty.
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // In-flight +/- writes, keyed by product name. A second +/- for a product whose
  // write is still running is ignored (and that row's buttons are disabled), so a
  // double-tap can't double-apply. This is PER-PRODUCT, not a global lock — clicks
  // on other rows stay fully responsive. The ref is the synchronous source of
  // truth for the guard (reading `pending` state would be stale within a burst of
  // taps, before a re-render lands); `pending` mirrors it only to disable buttons.
  const pendingRef = useRef<Set<string>>(new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(pendingRef.current);

  // Patch one row in the shared cache by name. Functional updater, so concurrent
  // in-flight writes compose instead of clobbering. `prev ?? []` because the cache
  // can momentarily be undefined (a write racing ahead of the first read).
  const patchItem = useCallback(
    (name: string, patch: (it: InventoryItem) => InventoryItem) => {
      queryClient.setQueryData<InventoryItem[]>(INVENTORY_STOCK_KEY, (prev) =>
        (prev ?? []).map((it) => (it.name === name ? patch(it) : it)),
      );
    },
    [queryClient],
  );

  const changeQuantity = useCallback(
    async (product: string, delta: number) => {
      // 0. GUARD double-submit: ignore a +/- for a product whose write is still in
      //    flight. The ref check is synchronous, so it also catches a second tap in
      //    the micro-window before the disabled buttons re-render.
      if (pendingRef.current.has(product)) return;
      const nextPending = new Set(pendingRef.current).add(product);
      pendingRef.current = nextPending;
      setPending(nextPending);

      // 1. OPTIMISTIC: apply the delta straight into the SHARED cache, before
      //    awaiting, so the tap has instant feedback AND the dashboard card (reading
      //    the same cache) moves in lockstep.
      setWriteError(null);
      patchItem(product, (it) => ({ ...it, quantity: it.quantity + delta }));

      try {
        const res = await runIntentAction("inventory.update_quantity", { product, delta });

        if (res.ok) {
          // 2. Reconcile the cache to the server's AUTHORITATIVE quantity. No
          //    refetch — the server already told us the answer, so invalidating
          //    would only re-fetch the whole list to learn what we already know.
          //    Deliberately runs even if we've since unmounted: the cache is shared,
          //    so this keeps the dashboard card correct.
          const { name, quantity } = res.data as { name: string; quantity: number };
          patchItem(name, (it) => ({ ...it, quantity }));
        } else {
          // 3. REVERT this click's optimistic delta in the cache (subtracting the
          //    same delta removes only THIS click's contribution, safe under
          //    concurrent clicks) and surface the real error. The cache is written
          //    only on these chosen paths, so a failure leaves it consistent — never
          //    corrupted.
          patchItem(product, (it) => ({ ...it, quantity: it.quantity - delta }));
          if (mounted.current) setWriteError(res.code);
        }
      } finally {
        // Clear the in-flight mark whether the write succeeded, failed, or threw —
        // the row's buttons re-enable and the ref never leaks a stuck product.
        const cleared = new Set(pendingRef.current);
        cleared.delete(product);
        pendingRef.current = cleared;
        if (mounted.current) setPending(cleared);
      }
    },
    [patchItem],
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

      {writeError ? (
        <p
          role="alert"
          className="flex items-start gap-xs rounded-md bg-danger/10 px-sm py-xs type-label text-danger"
        >
          <InfoIcon width={18} height={18} aria-hidden className="mt-2xs shrink-0" />
          <span>
            {t(writeError === "failed" ? "inventory.errorFailed" : "inventory.errorDenied")}
          </span>
        </p>
      ) : null}

      {adding ? (
        <AddProductForm
          onCreated={(item) => {
            // add_product returns { id }; the rest of the row is exactly what we
            // submitted, so append it straight into the SHARED cache — no refetch,
            // and the dashboard card sees the new item immediately.
            queryClient.setQueryData<InventoryItem[]>(INVENTORY_STOCK_KEY, (prev) => [
              ...(prev ?? []),
              item,
            ]);
            setAdding(false);
            setWriteError(null);
          }}
          onError={(code) => setWriteError(code)}
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
            // This row has a +/- write in flight — disable its steppers so a second
            // tap can't double-apply. Other rows are unaffected.
            const rowPending = pending.has(item.name);
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
                    disabled={rowPending}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-hairline text-ink interactive motion-safe:active:scale-[0.97]"
                  >
                    <MinusIcon width={18} height={18} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("inventory.increase")}
                    onClick={() => changeQuantity(item.name, 1)}
                    disabled={rowPending}
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
  onCreated,
  onError,
}: {
  onCreated: (item: InventoryItem) => void;
  onError: (code: WriteErrorCode) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("0");
  const [unit, setUnit] = useState("");
  const [threshold, setThreshold] = useState("0");
  // Which required fields are currently blank-on-submit. Drives the per-field
  // marking + message; cleared for a field as soon as the user edits it.
  const [invalid, setInvalid] = useState<{ name: boolean; unit: boolean }>({
    name: false,
    unit: false,
  });
  // True while an add is in flight. Disables the submit button and makes a second
  // submit a no-op, so a double-tap can't write a duplicate row.
  const [submitting, setSubmitting] = useState(false);

  // Guard: onCreated/onError setState in the PARENT after the await. If we unmount
  // mid-submit, this stops us from touching the parent's state.
  const mounted = useRef(true);
  useEffect(() => {
    // Re-arm on every (re)mount. Under StrictMode React runs mount → cleanup →
    // mount; setting `true` here (not only `false` in cleanup) means the second
    // mount re-enables the guard instead of leaving it permanently disarmed,
    // which would swallow every later setState and strand the view empty.
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const inputClass =
    "w-full rounded-md bg-screen px-sm py-sm type-body text-ink outline-none placeholder:text-muted";
  const invalidRing = "ring-1 ring-danger";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // A second submit while one is already in flight is a no-op (belt-and-suspenders
    // with the disabled button — this also covers Enter-key resubmits).
    if (submitting) return;

    const nextName = name.trim();
    const nextUnit = unit.trim();

    // Required-field validation is VISIBLE now — a blank field marks itself and
    // says what is missing, instead of the submit silently doing nothing.
    const nextInvalid = { name: nextName === "", unit: nextUnit === "" };
    setInvalid(nextInvalid);
    if (nextInvalid.name || nextInvalid.unit) return;

    const quantityValue = Number(quantity) || 0;
    const reorderThreshold = Number(threshold) || 0;

    // Lock only AFTER validation passes, so a failed validation leaves the button
    // usable. Released in `finally`, whatever the outcome.
    setSubmitting(true);
    try {
      // No ctx argument — the server builds it from the session.
      const res = await runIntentAction("inventory.add_product", {
        name: nextName,
        quantity: quantityValue,
        unit: nextUnit,
        reorderThreshold,
      });
      if (!mounted.current) return;

      if (res.ok) {
        // add_product returns only { id }; the rest of the InventoryItem is the
        // values we just submitted, so we can hand a complete row up to append.
        const { id } = res.data as { id: string };
        onCreated({ id, name: nextName, quantity: quantityValue, unit: nextUnit, reorderThreshold });
      } else {
        onError(res.code);
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-sm rounded-lg bg-card p-md">
      <label className="flex flex-col gap-2xs type-label text-muted">
        <span>
          {t("inventory.productName")} <span aria-hidden="true" className="text-danger">*</span>
        </span>
        <input
          className={invalid.name ? `${inputClass} ${invalidRing}` : inputClass}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (invalid.name) setInvalid((v) => ({ ...v, name: false }));
          }}
          aria-required="true"
          aria-invalid={invalid.name}
        />
        {invalid.name ? (
          <span role="alert" className="type-caption text-danger">
            {t("inventory.fieldRequired")}
          </span>
        ) : null}
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
          <span>
            {t("inventory.unit")} <span aria-hidden="true" className="text-danger">*</span>
          </span>
          <input
            className={invalid.unit ? `${inputClass} ${invalidRing}` : inputClass}
            value={unit}
            placeholder={t("inventory.unitPlaceholder")}
            onChange={(e) => {
              setUnit(e.target.value);
              if (invalid.unit) setInvalid((v) => ({ ...v, unit: false }));
            }}
            aria-required="true"
            aria-invalid={invalid.unit}
          />
          {invalid.unit ? (
            <span role="alert" className="type-caption text-danger">
              {t("inventory.fieldRequired")}
            </span>
          ) : null}
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
        disabled={submitting}
        className="rounded-md bg-app-amber py-sm type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
      >
        {t("inventory.add")}
      </button>
    </form>
  );
}
