"use client";

/**
 * The orders tool's three forms — supplier, category, product. Each renders
 * either as a MODAL (add) or INLINE in place of a row (edit), from the same
 * fields, so add and edit can never drift apart.
 *
 * Every form: visible required-field validation, a "name already exists" check
 * done client-side against the cached list (so a duplicate gets a clear message
 * instead of the DB unique constraint's generic failure), a submitting lock
 * against double-submit, and its OWN error banner (an error behind a modal's
 * scrim would be invisible).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/i18n";
import type { Category, Product } from "../logic";
import {
  CATEGORY_NAME_MAX,
  PRODUCT_NAME_MAX,
  SUPPLIER_LIMITS,
} from "../intents";
import { UNIT_KEYS, unitLabelKey } from "../units";
import { byName, normalizeName, sameName } from "../catalog";
import type { ProductDraft, SupplierDraft } from "./useOrdersWrites";
import {
  FormActions,
  Modal,
  SelectField,
  TextField,
  WriteErrorBanner,
  inputClass,
  useMounted,
  type WriteErrorCode,
} from "./shared";

type Mode = "modal" | "inline";

/** Wraps the fields in a modal or an inline card, per `mode`. */
function FormFrame({
  mode,
  title,
  onClose,
  onSubmit,
  children,
}: {
  mode: Mode;
  title: string;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  children: ReactNode;
}) {
  if (mode === "modal") {
    return (
      <Modal title={title} onClose={onClose} onSubmit={onSubmit}>
        {children}
      </Modal>
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-sm rounded-lg bg-card p-md">
      {children}
    </form>
  );
}

/** Shared submit plumbing: lock, run, surface the code, release. */
function useSubmit() {
  const mounted = useMounted();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<WriteErrorCode | null>(null);

  async function run(write: () => Promise<WriteErrorCode | null>, onDone: () => void) {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const code = await write();
      if (!mounted.current) return;
      if (code) setError(code);
      else onDone();
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  return { submitting, error, run };
}

/** Focus the first field when a modal opens. */
function useAutoFocus(enabled: boolean) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (enabled) ref.current?.focus();
  }, [enabled]);
  return ref;
}

// --- supplier ---------------------------------------------------------------

export function SupplierForm({
  mode,
  initial,
  categories,
  onSubmit,
  onClose,
  onNeedCategory,
}: {
  mode: Mode;
  initial: SupplierDraft;
  categories: readonly Category[];
  /** Performs the write; resolves to the failure code or null. */
  onSubmit: (draft: SupplierDraft) => Promise<WriteErrorCode | null>;
  onClose: () => void;
  /** Shown as a button when no category exists yet. */
  onNeedCategory?: () => void;
}) {
  const { t, locale } = useI18n();
  const [draft, setDraft] = useState<SupplierDraft>(initial);
  const [showErrors, setShowErrors] = useState(false);
  const { submitting, error, run } = useSubmit();
  const nameRef = useAutoFocus(mode === "modal");

  const nameMissing = draft.name.trim() === "";
  const categoryMissing = draft.primaryCategoryId === "";
  const set = (key: keyof SupplierDraft) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setShowErrors(true);
    if (nameMissing || categoryMissing) return;
    const next: SupplierDraft = {
      name: draft.name.trim(),
      phone: draft.phone.trim(),
      contactName: draft.contactName.trim(),
      email: draft.email.trim(),
      notes: draft.notes.trim(),
      primaryCategoryId: draft.primaryCategoryId,
    };
    void run(() => onSubmit(next), onClose);
  }

  return (
    <FormFrame
      mode={mode}
      title={t(mode === "modal" ? "orders.addSupplier" : "orders.editSupplier")}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <WriteErrorBanner code={error} />
      <TextField
        label={t("orders.supplierName")}
        value={draft.name}
        onChange={set("name")}
        placeholder={t("orders.namePlaceholder")}
        maxLength={SUPPLIER_LIMITS.name}
        required
        error={showErrors && nameMissing ? t("orders.fieldRequired") : null}
        inputRef={nameRef}
      />
      {categories.length === 0 ? (
        <div className="flex flex-col gap-2xs rounded-md bg-danger/10 px-sm py-xs">
          <span className="type-label text-danger">{t("orders.needCategoryFirst")}</span>
          {onNeedCategory ? (
            <button
              type="button"
              onClick={onNeedCategory}
              className="self-start rounded-pill bg-app-green px-sm py-2xs type-caption text-on-fill interactive"
            >
              {t("orders.goToCategories")}
            </button>
          ) : null}
        </div>
      ) : (
        <SelectField
          label={t("orders.primaryCategory")}
          value={draft.primaryCategoryId}
          onChange={set("primaryCategoryId")}
          options={byName(categories, locale).map((c) => ({ value: c.id, label: c.name }))}
          placeholder={t("orders.chooseCategory")}
          required
          error={showErrors && categoryMissing ? t("orders.fieldRequired") : null}
        />
      )}
      <TextField
        label={t("orders.phone")}
        value={draft.phone}
        onChange={set("phone")}
        placeholder={t("orders.phonePlaceholder")}
        maxLength={SUPPLIER_LIMITS.phone}
        type="tel"
        dir="ltr"
      />
      <TextField
        label={t("orders.contactName")}
        value={draft.contactName}
        onChange={set("contactName")}
        placeholder={t("orders.contactNamePlaceholder")}
        maxLength={SUPPLIER_LIMITS.contactName}
      />
      <TextField
        label={t("orders.email")}
        value={draft.email}
        onChange={set("email")}
        placeholder={t("orders.emailPlaceholder")}
        maxLength={SUPPLIER_LIMITS.email}
        type="email"
        dir="ltr"
      />
      <label className="flex flex-col gap-2xs type-label text-muted">
        {t("orders.notes")}
        <textarea
          className={`${inputClass} min-h-20 resize-y`}
          value={draft.notes}
          placeholder={t("orders.notesPlaceholder")}
          maxLength={SUPPLIER_LIMITS.notes}
          rows={2}
          onChange={(e) => set("notes")(e.target.value)}
        />
      </label>
      <FormActions
        submitLabel={t(mode === "modal" ? "orders.add" : "orders.save")}
        onCancel={onClose}
        submitting={submitting}
      />
    </FormFrame>
  );
}

// --- category ---------------------------------------------------------------

export function CategoryForm({
  mode,
  initialName,
  editingId,
  categories,
  onSubmit,
  onClose,
}: {
  mode: Mode;
  initialName: string;
  /** The category being renamed (excluded from the duplicate check). */
  editingId?: string;
  categories: readonly Category[];
  onSubmit: (name: string) => Promise<WriteErrorCode | null>;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const [name, setName] = useState(initialName);
  const [showErrors, setShowErrors] = useState(false);
  const { submitting, error, run } = useSubmit();
  const nameRef = useAutoFocus(mode === "modal");

  const missing = name.trim() === "";
  const duplicate =
    !missing && categories.some((c) => c.id !== editingId && sameName(c.name, name, locale));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setShowErrors(true);
    if (missing || duplicate) return;
    void run(() => onSubmit(name.trim()), onClose);
  }

  return (
    <FormFrame
      mode={mode}
      title={t(mode === "modal" ? "orders.addCategory" : "orders.editCategory")}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <WriteErrorBanner code={error} />
      <TextField
        label={t("orders.categoryName")}
        value={name}
        onChange={setName}
        placeholder={t("orders.categoryPlaceholder")}
        maxLength={CATEGORY_NAME_MAX}
        required
        error={
          showErrors && missing
            ? t("orders.fieldRequired")
            : showErrors && duplicate
              ? t("orders.nameExists")
              : null
        }
        inputRef={nameRef}
      />
      <FormActions
        submitLabel={t(mode === "modal" ? "orders.add" : "orders.save")}
        onCancel={onClose}
        submitting={submitting}
      />
    </FormFrame>
  );
}

// --- product ----------------------------------------------------------------

export function ProductForm({
  mode,
  initial,
  editingId,
  supplierProducts,
  categories,
  onSubmit,
  onClose,
  onPasteList,
}: {
  mode: Mode;
  initial: ProductDraft;
  editingId?: string;
  /** ALL of this supplier's products — names are unique per supplier, across categories. */
  supplierProducts: readonly Product[];
  /** When given, the category is editable (inline edit); the modal fixes it. */
  categories?: readonly Category[];
  onSubmit: (draft: ProductDraft) => Promise<WriteErrorCode | null>;
  onClose: () => void;
  /** When given (add modal only), shows "Have a list? Paste it", which switches
   * to the bulk-paste flow for the same supplier + category. */
  onPasteList?: () => void;
}) {
  const { t, locale } = useI18n();
  const [draft, setDraft] = useState<ProductDraft>(initial);
  const [showErrors, setShowErrors] = useState(false);
  const { submitting, error, run } = useSubmit();
  const nameRef = useAutoFocus(mode === "modal");

  const missing = normalizeName(draft.name) === "";
  const duplicate =
    !missing &&
    supplierProducts.some((p) => p.id !== editingId && sameName(p.name, draft.name, locale));
  const categoryMissing = draft.categoryId === "";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setShowErrors(true);
    if (missing || duplicate || categoryMissing) return;
    // Saved with extra spaces collapsed, matching how duplicates are detected.
    void run(() => onSubmit({ ...draft, name: normalizeName(draft.name) }), onClose);
  }

  return (
    <FormFrame
      mode={mode}
      title={t(mode === "modal" ? "orders.addProduct" : "orders.editProduct")}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <WriteErrorBanner code={error} />
      {onPasteList ? (
        <button
          type="button"
          onClick={onPasteList}
          className="self-start type-label text-app-green underline interactive"
        >
          {t("orders.pasteListLink")}
        </button>
      ) : null}
      <TextField
        label={t("orders.productName")}
        value={draft.name}
        onChange={(name) => setDraft((d) => ({ ...d, name }))}
        placeholder={t("orders.productPlaceholder")}
        maxLength={PRODUCT_NAME_MAX}
        required
        error={
          showErrors && missing
            ? t("orders.fieldRequired")
            : showErrors && duplicate
              ? t("orders.nameExists")
              : null
        }
        inputRef={nameRef}
      />
      <SelectField
        label={t("orders.defaultUnit")}
        value={draft.defaultUnit}
        onChange={(defaultUnit) => setDraft((d) => ({ ...d, defaultUnit }))}
        options={UNIT_KEYS.map((key) => {
          const labelKey = unitLabelKey(key);
          return { value: key, label: labelKey ? t(labelKey) : key };
        })}
        placeholder={t("orders.noUnit")}
      />
      {categories ? (
        <SelectField
          label={t("orders.category")}
          value={draft.categoryId}
          onChange={(categoryId) => setDraft((d) => ({ ...d, categoryId }))}
          options={byName(categories, locale).map((c) => ({ value: c.id, label: c.name }))}
          placeholder={t("orders.chooseCategory")}
          required
          error={showErrors && categoryMissing ? t("orders.fieldRequired") : null}
        />
      ) : null}
      <FormActions
        submitLabel={t(mode === "modal" ? "orders.add" : "orders.save")}
        onCancel={onClose}
        submitting={submitting}
      />
    </FormFrame>
  );
}
