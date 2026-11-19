"use client";

/**
 * Inline item editor — shown in place of an item's row (as orders' inline forms
 * are): name (required) and free-text quantity. Visible required-field
 * validation, a submitting lock against double-submit, and its OWN error banner.
 */
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { ITEM_NAME_MAX, QUANTITY_MAX } from "../logic";
import {
  FormActions,
  TextField,
  WriteErrorBanner,
  useMounted,
  type WriteErrorCode,
} from "./shared";

export function ItemForm({
  initial,
  onSubmit,
  onClose,
}: {
  initial: { name: string; quantity: string };
  /** Resolves to null on success, or the failure code to show. */
  onSubmit: (draft: { name: string; quantity: string }) => Promise<WriteErrorCode | null>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const mounted = useMounted();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initial.name);
  const [quantity, setQuantity] = useState(initial.quantity);
  const [showRequired, setShowRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [writeError, setWriteError] = useState<WriteErrorCode | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setShowRequired(true);
      return;
    }
    setSubmitting(true);
    setWriteError(null);
    const code = await onSubmit({ name: trimmed, quantity: quantity.trim() });
    if (!mounted.current) return;
    setSubmitting(false);
    if (code) setWriteError(code);
    else onClose();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-sm rounded-lg bg-card p-md">
      <WriteErrorBanner code={writeError} />
      <TextField
        label={t("shopping.itemName")}
        value={name}
        onChange={(next) => {
          setName(next);
          if (next.trim()) setShowRequired(false);
        }}
        maxLength={ITEM_NAME_MAX}
        required
        error={showRequired ? t("shopping.itemNameRequired") : null}
        inputRef={inputRef}
      />
      <TextField
        label={t("shopping.quantity")}
        value={quantity}
        onChange={setQuantity}
        placeholder={t("shopping.quantityPlaceholder")}
        maxLength={QUANTITY_MAX}
      />
      <FormActions submitLabel={t("shopping.save")} onCancel={onClose} submitting={submitting} />
    </form>
  );
}
