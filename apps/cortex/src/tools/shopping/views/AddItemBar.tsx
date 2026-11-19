"use client";

/**
 * Floating add bar — the orders bar's chrome (translucent card, backdrop blur),
 * held by FullScreen's bottom dock (`sticky bottom-sm` + `mt-auto`). Two inputs
 * (name, quantity) and a + button; Enter adds too. Name is required — an empty
 * name does nothing. After adding, the fields clear and focus returns to name,
 * so several items go in one after another.
 */
import { useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { PlusIcon } from "@/components/icons";
import { ITEM_NAME_MAX, QUANTITY_MAX } from "../logic";

export function AddItemBar({
  onAdd,
}: {
  /** Resolves true when the item was added (the fields then clear). */
  onAdd: (draft: { name: string; quantity: string }) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    const added = await onAdd({ name: trimmed, quantity: quantity.trim() });
    setSubmitting(false);
    if (added) {
      setName("");
      setQuantity("");
    }
    nameRef.current?.focus();
  }

  return (
    <form
      onSubmit={submit}
      className="flex w-full max-w-md shrink-0 items-center gap-2xs rounded-pill border border-hairline bg-card/70 p-2xs shadow-lifted backdrop-blur-md"
    >
      <input
        ref={nameRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("shopping.addItemPlaceholder")}
        aria-label={t("shopping.itemName")}
        maxLength={ITEM_NAME_MAX}
        className="min-w-0 flex-1 bg-transparent px-sm py-2xs type-label text-ink outline-none placeholder:text-muted"
      />
      <span className="h-5 w-px shrink-0 bg-hairline" aria-hidden="true" />
      <input
        type="text"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        placeholder={t("shopping.quantityPlaceholder")}
        aria-label={t("shopping.quantity")}
        maxLength={QUANTITY_MAX}
        className="w-20 shrink-0 bg-transparent px-xs py-2xs type-label text-ink outline-none placeholder:text-muted"
      />
      <button
        type="submit"
        aria-label={t("shopping.addItem")}
        disabled={submitting}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-app-amber text-on-fill interactive motion-safe:active:scale-[0.97]"
      >
        <PlusIcon width={18} height={18} />
      </button>
    </form>
  );
}
