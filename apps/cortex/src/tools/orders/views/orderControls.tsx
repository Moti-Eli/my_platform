"use client";

/**
 * The two per-line controls of an order, shared by the products screen (ticked
 * rows) and the order summary, so a line edits the same way in both places.
 */
import { useI18n } from "@/i18n";
import { MinusIcon, PlusIcon } from "@/components/icons";
import { UNIT_KEYS, unitLabelKey } from "../units";
import { parseQty } from "../orderDraft";
import { formatQty } from "../whatsapp";

const stepButton =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-hairline text-ink interactive motion-safe:active:scale-[0.97]";

/**
 * − [qty] +. Starts at 1; "−" stops at 1 (smaller amounts like 0.5 are typed).
 * Typing accepts digits and one decimal point ("1,5" becomes "1.5"); an empty or
 * invalid value snaps back to 1 when the field loses focus.
 */
export function QtyStepper({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const { t } = useI18n();
  const n = parseQty(value);
  return (
    <div className="flex shrink-0 items-center gap-2xs">
      <button
        type="button"
        aria-label={t("orders.decrease")}
        disabled={n === null || n <= 1}
        onClick={() => onChange(formatQty((n ?? 2) - 1))}
        className={`${stepButton} ${n === null || n <= 1 ? "opacity-[var(--ds-disabled-opacity)]" : ""}`}
      >
        <MinusIcon width={14} height={14} />
      </button>
      <input
        type="text"
        inputMode="decimal"
        dir="ltr"
        aria-label={t("orders.quantity")}
        value={value}
        maxLength={7}
        onChange={(e) => {
          const next = e.target.value.replace(",", ".");
          if (/^\d*\.?\d*$/.test(next)) onChange(next);
        }}
        onBlur={() => {
          if (parseQty(value) === null) onChange("1");
        }}
        className="w-14 rounded-md bg-screen px-2xs py-2xs text-center type-body text-ink outline-none"
      />
      <button
        type="button"
        aria-label={t("orders.increase")}
        onClick={() => onChange(formatQty((n ?? 0) + 1))}
        className={stepButton}
      >
        <PlusIcon width={14} height={14} />
      </button>
    </div>
  );
}

/** Compact unit picker for one order line (any unit from the list, or none). */
export function UnitSelect({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const { t } = useI18n();
  return (
    <select
      aria-label={t("orders.defaultUnit")}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="min-w-0 rounded-md bg-screen px-xs py-2xs type-label text-ink outline-none"
    >
      <option value="">{t("orders.noUnit")}</option>
      {UNIT_KEYS.map((key) => {
        const labelKey = unitLabelKey(key);
        return (
          <option key={key} value={key}>
            {labelKey ? t(labelKey) : key}
          </option>
        );
      })}
    </select>
  );
}
