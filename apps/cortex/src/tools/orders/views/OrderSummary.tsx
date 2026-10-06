"use client";

/**
 * Order summary for ONE supplier — opened from "To order (X)". Not stored in the
 * database: it reads and edits the browser draft (`orderDraft.ts`).
 *
 *   - the ticked products, each with quantity (− / + / typed) and unit, removable
 *   - optional delivery date and note
 *   - the message EXACTLY as the supplier will see it (always Hebrew)
 *   - "Send on WhatsApp" → opens wa.me with the supplier's number and the text
 *
 * WhatsApp can't tell us whether the message was actually sent — the app only
 * OPENS it. So tapping send records `sentAt`, and the screen then asks "Was the
 * order sent?": "Yes" clears this supplier's selection and returns to its
 * products; "Not yet" keeps everything so it can be sent again. `sentAt` lives
 * in the draft, so the question survives the browser reloading the page while
 * WhatsApp was in front.
 *
 * A supplier with no usable phone: send is disabled, with a link that opens
 * that supplier's editor in suppliers management.
 */
import { useI18n } from "@/i18n";
import { CloseIcon } from "@/components/icons";
import type { OrdersLocation } from "../nav";
import { parseQty, useOrderDraft } from "../orderDraft";
import { buildOrderMessage, toWhatsAppNumber, whatsAppLink, type MessageLine } from "../whatsapp";
import type { CatalogData } from "./levels";
import { QtyStepper, UnitSelect } from "./orderControls";
import { AddButton, EmptyCard, ToolHeader, inputClass } from "./shared";

const NOTE_MAX = 500;

export function OrderSummary({
  data,
  supplierId,
  categoryId,
  orgName,
  go,
}: {
  data: CatalogData;
  supplierId: string;
  /** Where "back to products" / "yes, sent" return to. */
  categoryId?: string;
  orgName: string;
  go: (loc: OrdersLocation) => void;
}) {
  const { t } = useI18n();
  const order = useOrderDraft(supplierId);
  const { draft } = order;

  const supplier = data.suppliers.find((s) => s.id === supplierId);
  const backTo: OrdersLocation = categoryId
    ? { view: "products", categoryId, supplierId }
    : { view: "categories" };

  if (!supplier) {
    return (
      <>
        <ToolHeader title={t("orders.name")} />
        <EmptyCard titleKey="orders.notFoundTitle" hintKey="orders.notFoundHint" />
      </>
    );
  }

  // Ticked products that still exist (a deleted product just drops out).
  const lines = Object.entries(draft.items).flatMap(([productId, item]) => {
    const product = data.products.find((p) => p.id === productId && p.supplierId === supplierId);
    return product ? [{ productId, product, item }] : [];
  });
  const invalid = lines.some((l) => parseQty(l.item.qty) === null);
  const messageLines: MessageLine[] = lines.flatMap((l) => {
    const qty = parseQty(l.item.qty);
    return qty === null ? [] : [{ name: l.product.name, qty, unit: l.item.unit }];
  });
  const message = buildOrderMessage({
    supplierName: supplier.name,
    orgName,
    lines: messageLines,
    deliveryDate: draft.deliveryDate,
    note: draft.note,
  });
  const number = toWhatsAppNumber(supplier.phone);
  const canSend = number !== null && lines.length > 0 && !invalid;

  return (
    <>
      <ToolHeader title={supplier.name} subtitle={t("orders.orderSubtitle")} />

      {lines.length === 0 ? (
        <EmptyCard
          titleKey="orders.orderEmpty"
          hintKey="orders.orderEmptyHint"
          action={
            categoryId ? (
              <AddButton label={t("orders.backToProducts")} onClick={() => go(backTo)} />
            ) : undefined
          }
        />
      ) : (
        <>
          <span className="type-label text-muted">{t("orders.orderItemsTitle")}</span>
          <ul className="flex flex-col divide-y divide-hairline">
            {lines.map(({ productId, product, item }) => (
              <li key={productId} className="flex flex-wrap items-center gap-xs py-sm">
                <span className="min-w-0 flex-1 basis-32 truncate type-body text-ink">{product.name}</span>
                <QtyStepper value={item.qty} onChange={(qty) => order.setItem(productId, { qty })} />
                <UnitSelect value={item.unit} onChange={(unit) => order.setItem(productId, { unit })} />
                <button
                  type="button"
                  aria-label={t("orders.removeRow")}
                  onClick={() => order.remove(productId)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-hairline text-muted interactive motion-safe:active:scale-[0.97]"
                >
                  <CloseIcon width={14} height={14} />
                </button>
              </li>
            ))}
          </ul>
          {invalid ? (
            <p role="alert" className="type-caption text-danger">
              {t("orders.invalidQty")}
            </p>
          ) : null}

          <label className="flex flex-col gap-2xs type-label text-muted">
            {t("orders.deliveryDate")}
            <input
              type="date"
              className={inputClass}
              value={draft.deliveryDate}
              onChange={(e) => order.setDeliveryDate(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-2xs type-label text-muted">
            {t("orders.orderNote")}
            <textarea
              className={`${inputClass} min-h-20 resize-y`}
              value={draft.note}
              placeholder={t("orders.orderNotePlaceholder")}
              maxLength={NOTE_MAX}
              rows={2}
              onChange={(e) => order.setNote(e.target.value)}
            />
          </label>

          <div className="flex flex-col gap-2xs">
            <span className="type-label text-muted">{t("orders.previewMessage")}</span>
            {/* Always Hebrew → always RTL, whatever the app's direction. */}
            <pre
              dir="rtl"
              className="whitespace-pre-wrap rounded-lg bg-card p-md text-start font-sans type-body text-ink"
            >
              {message}
            </pre>
          </div>

          {number === null ? (
            <div className="flex flex-col gap-2xs rounded-md bg-danger/10 px-sm py-xs">
              <span className="type-label text-danger">{t("orders.noPhone")}</span>
              <button
                type="button"
                onClick={() => go({ view: "suppliers", editId: supplierId })}
                className="self-start type-label text-danger underline interactive"
              >
                {t("orders.editSupplierLink")}
              </button>
            </div>
          ) : null}

          {draft.sentAt ? (
            <div role="alert" className="flex flex-col gap-xs rounded-md bg-app-green/15 px-sm py-sm">
              <span className="type-heading text-ink">{t("orders.wasSent")}</span>
              <div className="flex flex-wrap gap-xs">
                <button
                  type="button"
                  onClick={() => {
                    order.clear();
                    go(backTo);
                  }}
                  className="rounded-pill bg-app-green px-md py-xs type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
                >
                  {t("orders.yesSent")}
                </button>
                <button
                  type="button"
                  onClick={order.clearSent}
                  className="rounded-pill bg-hairline px-md py-xs type-label text-ink interactive motion-safe:active:scale-[0.97]"
                >
                  {t("orders.notYet")}
                </button>
              </div>
            </div>
          ) : null}

          <button
            type="button"
            disabled={!canSend}
            onClick={() => {
              if (!number) return;
              window.open(whatsAppLink(number, message), "_blank", "noopener,noreferrer");
              order.markSent();
            }}
            className={`rounded-md bg-app-green py-sm type-heading text-on-fill interactive motion-safe:active:scale-[0.97] ${
              canSend ? "" : "opacity-[var(--ds-disabled-opacity)]"
            }`}
          >
            {t("orders.sendWhatsApp")}
          </button>
        </>
      )}
    </>
  );
}
