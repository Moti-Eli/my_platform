"use client";

/**
 * "Paste a list" — add many products to ONE supplier + category at once (e.g. a
 * list copied from WhatsApp). Two steps inside one modal:
 *
 *   1. edit    — a big textarea + ONE unit for the whole list (each product can
 *                be changed later through ✎).
 *   2. preview — every line that will become a product, each removable (✕).
 *                Lines that can't be added are MARKED, not hidden:
 *                  · already exists at this supplier (any category — names are
 *                    unique per supplier in the DB; the other category is named)
 *                  · duplicate of an earlier line in the same paste
 *                  · too long (over the product-name limit)
 *                Statuses are recomputed over the rows still in the list, so
 *                removing the first of two duplicates makes the second one new.
 *
 * Every name check ignores extra spaces (start, end and inside) — `sameName`.
 * Only "new" rows are sent, in ONE server call (`orders.create_products`). The
 * outcome goes back to the level as a summary for its notice banner.
 */
import { useState } from "react";
import { useI18n } from "@/i18n";
import { CloseIcon } from "@/components/icons";
import type { Category, Product } from "../logic";
import { PRODUCT_NAME_MAX } from "../intents";
import { UNIT_KEYS, unitLabelKey } from "../units";
import { sameName } from "../catalog";
import { MAX_LIST_LINES, parseList } from "../parseList";
import { useOrdersWrites } from "./useOrdersWrites";
import {
  Modal,
  SelectField,
  WriteErrorBanner,
  inputClass,
  useMounted,
  type WriteErrorCode,
} from "./shared";

/** What happened, for the level's notice banner. */
export interface BulkSummary {
  added: number;
  /** Already at this supplier (any category). */
  skippedExisting: number;
  /** Appeared more than once in the same paste. */
  skippedDuplicate: number;
  skippedTooLong: number;
  /** Server-side insert failures (not atomic — see logic.createProducts). */
  failed: number;
}

type RowStatus = "new" | "exists" | "duplicate" | "tooLong";

interface PreviewRow {
  /** Position in the paste — stable key, survives removals. */
  key: number;
  name: string;
  status: RowStatus;
  /** For "exists" in ANOTHER category: that category's name. */
  existingCategory?: string;
}

/** Status of every row still in the list, in paste order. */
function classify(
  rows: Array<{ key: number; name: string }>,
  supplierProducts: readonly Product[],
  categoryId: string,
  categories: readonly Category[],
  locale: string,
): PreviewRow[] {
  const accepted: string[] = [];
  return rows.map(({ key, name }) => {
    if (name.length > PRODUCT_NAME_MAX) return { key, name, status: "tooLong" };
    const existing = supplierProducts.find((p) => sameName(p.name, name, locale));
    if (existing) {
      const other =
        existing.categoryId !== categoryId
          ? categories.find((c) => c.id === existing.categoryId)?.name
          : undefined;
      return { key, name, status: "exists", existingCategory: other };
    }
    if (accepted.some((a) => sameName(a, name, locale))) return { key, name, status: "duplicate" };
    accepted.push(name);
    return { key, name, status: "new" };
  });
}

export function BulkProducts({
  supplierId,
  categoryId,
  supplierProducts,
  categories,
  onClose,
  onDone,
  initialText = "",
}: {
  supplierId: string;
  categoryId: string;
  /** ALL of this supplier's products — the "already exists" check spans categories. */
  supplierProducts: readonly Product[];
  categories: readonly Category[];
  onClose: () => void;
  onDone: (summary: BulkSummary) => void;
  /** Pre-filled text — a multi-line paste that landed in the single name field. */
  initialText?: string;
}) {
  const { t, locale } = useI18n();
  const writes = useOrdersWrites();
  const mounted = useMounted();
  const [step, setStep] = useState<"edit" | "preview">("edit");
  const [text, setText] = useState(initialText);
  const [unit, setUnit] = useState("");
  const [removed, setRemoved] = useState<ReadonlySet<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<WriteErrorCode | null>(null);

  const parsed = parseList(text);
  const rows = classify(
    parsed.names.map((name, key) => ({ key, name })).filter((r) => !removed.has(r.key)),
    supplierProducts,
    categoryId,
    categories,
    locale,
  );
  const toAdd = rows.filter((r) => r.status === "new");

  async function save() {
    if (submitting || toAdd.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await writes.createProducts(
        supplierId,
        categoryId,
        unit,
        toAdd.map((r) => r.name),
      );
      if (!mounted.current) return;
      if (res.error) {
        setError(res.error);
        return;
      }
      onDone({
        added: res.created,
        skippedExisting: rows.filter((r) => r.status === "exists").length,
        skippedDuplicate: rows.filter((r) => r.status === "duplicate").length,
        skippedTooLong: rows.filter((r) => r.status === "tooLong").length,
        failed: res.failed,
      });
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  if (step === "edit") {
    const canPreview = parsed.names.length > 0 && !parsed.tooMany;
    return (
      <Modal
        title={t("orders.pasteListTitle")}
        onClose={onClose}
        onSubmit={(e) => {
          e.preventDefault();
          if (!canPreview) return;
          setRemoved(new Set());
          setStep("preview");
        }}
      >
        <label className="flex flex-col gap-2xs type-label text-muted">
          {t("orders.pasteListLabel")}
          <textarea
            autoFocus
            className={`${inputClass} min-h-48 resize-y`}
            value={text}
            placeholder={t("orders.pasteListPlaceholder")}
            rows={10}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        {parsed.tooMany ? (
          <p role="alert" className="type-caption text-danger">
            {t("orders.listTooMany").replace("{max}", String(MAX_LIST_LINES))}
          </p>
        ) : null}
        <SelectField
          label={t("orders.unitForAll")}
          value={unit}
          onChange={setUnit}
          options={UNIT_KEYS.map((key) => {
            const labelKey = unitLabelKey(key);
            return { value: key, label: labelKey ? t(labelKey) : key };
          })}
          placeholder={t("orders.noUnit")}
        />
        <div className="flex gap-sm pt-xs">
          <button
            type="submit"
            disabled={!canPreview}
            className={`flex-1 rounded-md bg-app-green py-sm type-label text-on-fill interactive motion-safe:active:scale-[0.97] ${
              canPreview ? "" : "opacity-[var(--ds-disabled-opacity)]"
            }`}
          >
            {t("orders.toPreview")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-md bg-hairline py-sm type-label text-ink interactive motion-safe:active:scale-[0.97]"
          >
            {t("orders.cancel")}
          </button>
        </div>
      </Modal>
    );
  }

  const unitLabel = unitLabelKey(unit);
  return (
    <Modal
      title={t("orders.previewTitle")}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <WriteErrorBanner code={error} />
      <p className="type-label text-muted">
        {unitLabel ? `${t("orders.defaultUnit")}: ${t(unitLabel)}` : `${t("orders.defaultUnit")}: ${t("orders.noUnit")}`}
      </p>
      {rows.length === 0 ? (
        <p className="type-label text-muted">{t("orders.listEmpty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center gap-xs py-xs">
              <div className="flex min-w-0 flex-1 flex-col">
                <span
                  className={`truncate type-body ${r.status === "new" ? "text-ink" : "text-muted line-through"}`}
                >
                  {r.name}
                </span>
                {r.status !== "new" ? (
                  <span className="type-caption text-danger">
                    {r.status === "tooLong"
                      ? t("orders.statusTooLong")
                      : r.status === "duplicate"
                        ? t("orders.statusDuplicate")
                        : r.existingCategory
                          ? t("orders.statusExistsIn").replace("{category}", r.existingCategory)
                          : t("orders.statusExists")}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                aria-label={t("orders.removeRow")}
                onClick={() => setRemoved((prev) => new Set(prev).add(r.key))}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-hairline text-muted interactive motion-safe:active:scale-[0.97]"
              >
                <CloseIcon width={14} height={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-sm pt-xs">
        <button
          type="submit"
          disabled={submitting || toAdd.length === 0}
          className={`flex-1 rounded-md bg-app-green py-sm type-label text-on-fill interactive motion-safe:active:scale-[0.97] ${
            toAdd.length === 0 ? "opacity-[var(--ds-disabled-opacity)]" : ""
          }`}
        >
          {toAdd.length === 0
            ? t("orders.nothingToAdd")
            : toAdd.length === 1
              ? t("orders.addOne")
              : t("orders.addMany").replace("{count}", String(toAdd.length))}
        </button>
        <button
          type="button"
          onClick={() => setStep("edit")}
          disabled={submitting}
          className="flex-1 rounded-md bg-hairline py-sm type-label text-ink interactive motion-safe:active:scale-[0.97]"
        >
          {t("orders.backToEdit")}
        </button>
      </div>
    </Modal>
  );
}

/** "Added 3 products, 1 skipped because it appeared twice in the list" — the
 * notice text. Each skip reason is its own phrase, shown only when it applies. */
export function useBulkSummaryText() {
  const { t } = useI18n();
  const part = (n: number, oneKey: Parameters<typeof t>[0], manyKey: Parameters<typeof t>[0]) =>
    n === 1 ? t(oneKey) : t(manyKey).replace("{count}", String(n));
  return (s: BulkSummary) =>
    [
      s.added === 0 ? t("orders.addedNone") : part(s.added, "orders.addedOne", "orders.addedMany"),
      s.skippedExisting > 0
        ? part(s.skippedExisting, "orders.skippedExistsOne", "orders.skippedExistsMany")
        : null,
      s.skippedDuplicate > 0
        ? part(s.skippedDuplicate, "orders.skippedDupOne", "orders.skippedDupMany")
        : null,
      s.skippedTooLong > 0
        ? part(s.skippedTooLong, "orders.skippedLongOne", "orders.skippedLongMany")
        : null,
      s.failed > 0 ? part(s.failed, "orders.failedOne", "orders.failedMany") : null,
    ]
      .filter((p): p is string => p !== null)
      .join(", ");
}
