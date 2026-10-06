"use client";

/**
 * The orders tool's screens, one component each:
 *
 *   CategoriesLevel        — level 1, the main screen
 *   CategorySuppliersLevel — level 2, suppliers in one category
 *   ProductsLevel          — level 3, one supplier's products in one category
 *   SuppliersManager       — supplier admin, behind the hamburger
 *
 * Each receives the already-loaded catalog (FullScreen reads the three shared
 * caches once), the current search text (from the floating bar — it filters THIS
 * level only), and `go` to move between levels. All writes go through
 * `useOrdersWrites`, which reconciles the shared caches.
 */
import { useState } from "react";
import { useI18n } from "@/i18n";
import type { Category, Product, Supplier } from "../logic";
import {
  byName,
  categoryDeleteBlock,
  productsOf,
  suppliersInCategory,
} from "../catalog";
import { unitLabelKey } from "../units";
import type { OrdersLocation } from "../nav";
import { CategoryForm, ProductForm, SupplierForm } from "./forms";
import { useOrdersWrites, type SupplierDraft } from "./useOrdersWrites";
import {
  AddButton,
  EmptyCard,
  Modal,
  NavRow,
  RowActions,
  ToolHeader,
  WriteErrorBanner,
  useCountLabel,
  type WriteErrorCode,
} from "./shared";

export interface CatalogData {
  suppliers: Supplier[];
  categories: Category[];
  products: Product[];
}

interface LevelProps {
  data: CatalogData;
  search: string;
  go: (loc: OrdersLocation) => void;
}

const EMPTY_SUPPLIER: SupplierDraft = {
  name: "",
  phone: "",
  contactName: "",
  email: "",
  notes: "",
  primaryCategoryId: "",
};

/** Case-insensitive "contains" on any of the given fields. */
function matches(query: string, locale: string, ...fields: string[]): boolean {
  const q = query.trim().toLocaleLowerCase(locale);
  return q === "" || fields.some((f) => f.toLocaleLowerCase(locale).includes(q));
}

/** Shared row-level write state: which row is editing / mid-delete, and the error. */
function useRowState() {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<WriteErrorCode | null>(null);
  return { editingId, setEditingId, confirmId, setConfirmId, writeError, setWriteError };
}

// --- level 1 ----------------------------------------------------------------

export function CategoriesLevel({ data, search, go }: LevelProps) {
  const { t, locale } = useI18n();
  const count = useCountLabel();
  const writes = useOrdersWrites();
  const rows = useRowState();
  const [adding, setAdding] = useState(false);
  // Which category's "can't delete" explanation is showing.
  const [blockedId, setBlockedId] = useState<string | null>(null);

  const visible = byName(data.categories, locale).filter((c) => matches(search, locale, c.name));

  return (
    <>
      <ToolHeader
        title={t("orders.name")}
        action={<AddButton label={t("orders.addCategory")} onClick={() => setAdding(true)} />}
      />
      <WriteErrorBanner code={rows.writeError} />

      {adding ? (
        <CategoryForm
          mode="modal"
          initialName=""
          categories={data.categories}
          onSubmit={async (name) => (await writes.createCategory(name)).error}
          onClose={() => setAdding(false)}
        />
      ) : null}

      <span className="type-label text-muted">{t("orders.categoriesTitle")}</span>

      {data.categories.length === 0 ? (
        <EmptyCard
          titleKey="orders.emptyCategoriesTitle"
          hintKey="orders.emptyCategoriesHint"
          action={<AddButton label={t("orders.addCategory")} onClick={() => setAdding(true)} />}
        />
      ) : visible.length === 0 ? (
        <EmptyCard titleKey="orders.searchEmptyTitle" hintKey="orders.searchEmptyHint" />
      ) : (
        <ul className="flex flex-col divide-y divide-hairline">
          {visible.map((c) => {
            if (rows.editingId === c.id) {
              return (
                <li key={c.id} className="py-sm">
                  <CategoryForm
                    mode="inline"
                    initialName={c.name}
                    editingId={c.id}
                    categories={data.categories}
                    onSubmit={(name) => writes.renameCategory(c.id, name)}
                    onClose={() => rows.setEditingId(null)}
                  />
                </li>
              );
            }
            const n = suppliersInCategory(c.id, data.suppliers, data.products).length;
            const block = categoryDeleteBlock(c.id, data.suppliers, data.products);
            return (
              <li key={c.id}>
                <NavRow
                  title={c.name}
                  meta={count(n, "orders.suppliersOne", "orders.suppliersMany")}
                  onOpen={() => go({ view: "category", categoryId: c.id })}
                >
                  <RowActions
                    onEdit={() => {
                      rows.setConfirmId(null);
                      setBlockedId(null);
                      rows.setEditingId(c.id);
                    }}
                    confirming={rows.confirmId === c.id}
                    deleteDisabled={block !== null}
                    onArmDelete={() => {
                      if (block) {
                        setBlockedId((cur) => (cur === c.id ? null : c.id));
                        return;
                      }
                      rows.setConfirmId(c.id);
                    }}
                    onConfirmDelete={() => {
                      rows.setConfirmId(null);
                      rows.setWriteError(null);
                      void writes.deleteCategory(c.id).then((code) => rows.setWriteError(code));
                    }}
                    confirmLabel={t("orders.confirmDelete")}
                  />
                </NavRow>
                {blockedId === c.id && block ? (
                  <p className="pb-sm type-caption text-muted">
                    {t(
                      block === "hasProducts"
                        ? "orders.categoryBlockedProducts"
                        : "orders.categoryBlockedPrimary",
                    )}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

// --- level 2 ----------------------------------------------------------------

export function CategorySuppliersLevel({
  data,
  search,
  go,
  categoryId,
}: LevelProps & { categoryId: string }) {
  const { t, locale } = useI18n();
  const count = useCountLabel();
  const writes = useOrdersWrites();
  // "+ ספק": the full supplier form with this category preselected.
  const [addingSupplier, setAddingSupplier] = useState(false);
  // Empty-state "+ הוסף מוצר": pick a supplier, then add its product here.
  const [pickingSupplier, setPickingSupplier] = useState(false);
  const [productFor, setProductFor] = useState<string | null>(null);

  const category = data.categories.find((c) => c.id === categoryId);
  if (!category) return <NotFound />;

  const inCategory = suppliersInCategory(categoryId, data.suppliers, data.products);
  const visible = byName(inCategory, locale).filter((s) => matches(search, locale, s.name, s.contactName));

  return (
    <>
      <ToolHeader
        title={category.name}
        subtitle={t("orders.name")}
        action={<AddButton label={t("orders.addSupplier")} onClick={() => setAddingSupplier(true)} />}
      />

      {addingSupplier ? (
        <SupplierForm
          mode="modal"
          initial={{ ...EMPTY_SUPPLIER, primaryCategoryId: categoryId }}
          categories={data.categories}
          onSubmit={async (draft) => (await writes.createSupplier(draft)).error}
          onClose={() => setAddingSupplier(false)}
        />
      ) : null}

      {pickingSupplier ? (
        <SupplierPicker
          suppliers={data.suppliers}
          onPick={(id) => {
            setPickingSupplier(false);
            setProductFor(id);
          }}
          onNew={() => {
            setPickingSupplier(false);
            setAddingSupplier(true);
          }}
          onClose={() => setPickingSupplier(false)}
        />
      ) : null}

      {productFor ? (
        <ProductForm
          mode="modal"
          initial={{ name: "", categoryId, defaultUnit: "" }}
          supplierProducts={data.products.filter((p) => p.supplierId === productFor)}
          onSubmit={(draft) => writes.createProduct(productFor, draft)}
          onClose={() => setProductFor(null)}
        />
      ) : null}

      <span className="type-label text-muted">{t("orders.suppliersTitle")}</span>

      {inCategory.length === 0 ? (
        <EmptyCard
          titleKey="orders.emptyCategoryTitle"
          hintKey="orders.emptyCategoryHint"
          action={<AddButton label={t("orders.addProduct")} onClick={() => setPickingSupplier(true)} />}
        />
      ) : visible.length === 0 ? (
        <EmptyCard titleKey="orders.searchEmptyTitle" hintKey="orders.searchEmptyHint" />
      ) : (
        <ul className="flex flex-col divide-y divide-hairline">
          {visible.map((s) => (
            <li key={s.id}>
              <NavRow
                title={s.name}
                meta={count(
                  productsOf(data.products, s.id, categoryId).length,
                  "orders.productsOne",
                  "orders.productsMany",
                )}
                onOpen={() => go({ view: "products", categoryId, supplierId: s.id })}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** "Which supplier?" — every supplier A–Z, plus "New supplier". */
function SupplierPicker({
  suppliers,
  onPick,
  onNew,
  onClose,
}: {
  suppliers: readonly Supplier[];
  onPick: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  return (
    <Modal title={t("orders.chooseSupplier")} onClose={onClose} onSubmit={(e) => e.preventDefault()}>
      <ul className="flex flex-col divide-y divide-hairline">
        {byName(suppliers, locale).map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onPick(s.id)}
              className="w-full py-sm text-start type-body text-ink interactive"
            >
              {s.name}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onNew}
        className="rounded-md bg-app-green/15 py-sm type-label text-app-green interactive motion-safe:active:scale-[0.97]"
      >
        + {t("orders.newSupplier")}
      </button>
    </Modal>
  );
}

// --- level 3 ----------------------------------------------------------------

export function ProductsLevel({
  data,
  search,
  categoryId,
  supplierId,
}: LevelProps & { categoryId: string; supplierId: string }) {
  const { t, locale } = useI18n();
  const writes = useOrdersWrites();
  const rows = useRowState();
  const [adding, setAdding] = useState(false);

  const category = data.categories.find((c) => c.id === categoryId);
  const supplier = data.suppliers.find((s) => s.id === supplierId);
  if (!category || !supplier) return <NotFound />;

  const supplierProducts = data.products.filter((p) => p.supplierId === supplierId);
  const inCategory = productsOf(data.products, supplierId, categoryId);
  const visible = byName(inCategory, locale).filter((p) => matches(search, locale, p.name));

  return (
    <>
      <ToolHeader
        title={supplier.name}
        subtitle={category.name}
        action={<AddButton label={t("orders.addProduct")} onClick={() => setAdding(true)} />}
      />
      <WriteErrorBanner code={rows.writeError} />

      {adding ? (
        <ProductForm
          mode="modal"
          initial={{ name: "", categoryId, defaultUnit: "" }}
          supplierProducts={supplierProducts}
          onSubmit={(draft) => writes.createProduct(supplierId, draft)}
          onClose={() => setAdding(false)}
        />
      ) : null}

      {inCategory.length === 0 ? (
        <EmptyCard
          titleKey="orders.emptyProductsTitle"
          hintKey="orders.emptyProductsHint"
          action={<AddButton label={t("orders.addProduct")} onClick={() => setAdding(true)} />}
        />
      ) : visible.length === 0 ? (
        <EmptyCard titleKey="orders.searchEmptyTitle" hintKey="orders.searchEmptyHint" />
      ) : (
        <ul className="flex flex-col divide-y divide-hairline">
          {visible.map((p) => {
            if (rows.editingId === p.id) {
              return (
                <li key={p.id} className="py-sm">
                  <ProductForm
                    mode="inline"
                    initial={{ name: p.name, categoryId: p.categoryId, defaultUnit: p.defaultUnit }}
                    editingId={p.id}
                    supplierProducts={supplierProducts}
                    categories={data.categories}
                    onSubmit={(draft) => writes.updateProduct(p.id, draft)}
                    onClose={() => rows.setEditingId(null)}
                  />
                </li>
              );
            }
            const unitKey = unitLabelKey(p.defaultUnit);
            return (
              <li key={p.id} className="flex items-center gap-sm py-sm">
                <span className="min-w-0 flex-1 truncate type-heading text-ink">{p.name}</span>
                {p.defaultUnit ? (
                  <span className="shrink-0 type-label text-muted">
                    {unitKey ? t(unitKey) : p.defaultUnit}
                  </span>
                ) : null}
                <RowActions
                  onEdit={() => {
                    rows.setConfirmId(null);
                    rows.setEditingId(p.id);
                  }}
                  confirming={rows.confirmId === p.id}
                  onArmDelete={() => rows.setConfirmId(p.id)}
                  onConfirmDelete={() => {
                    rows.setConfirmId(null);
                    rows.setWriteError(null);
                    void writes.deleteProduct(p.id).then((code) => rows.setWriteError(code));
                  }}
                  confirmLabel={t("orders.confirmDelete")}
                />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

// --- suppliers manager ------------------------------------------------------

export function SuppliersManager({ data, search, go }: LevelProps) {
  const { t, locale } = useI18n();
  const count = useCountLabel();
  const writes = useOrdersWrites();
  const rows = useRowState();
  const [adding, setAdding] = useState(false);

  const categoryName = new Map(data.categories.map((c) => [c.id, c.name]));
  const visible = byName(data.suppliers, locale).filter((s) =>
    matches(search, locale, s.name, s.contactName),
  );

  return (
    <>
      <ToolHeader
        title={t("orders.manageSuppliers")}
        subtitle={t("orders.name")}
        action={<AddButton label={t("orders.addSupplier")} onClick={() => setAdding(true)} />}
      />
      <WriteErrorBanner code={rows.writeError} />

      {adding ? (
        <SupplierForm
          mode="modal"
          initial={EMPTY_SUPPLIER}
          categories={data.categories}
          onSubmit={async (draft) => (await writes.createSupplier(draft)).error}
          onClose={() => setAdding(false)}
          onNeedCategory={() => {
            setAdding(false);
            go({ view: "categories" });
          }}
        />
      ) : null}

      {data.suppliers.length === 0 ? (
        <EmptyCard
          titleKey="orders.emptyTitle"
          hintKey="orders.emptyHint"
          action={<AddButton label={t("orders.addSupplier")} onClick={() => setAdding(true)} />}
        />
      ) : visible.length === 0 ? (
        <EmptyCard titleKey="orders.searchEmptyTitle" hintKey="orders.searchEmptyHint" />
      ) : (
        <ul className="flex flex-col divide-y divide-hairline">
          {visible.map((s) => {
            if (rows.editingId === s.id) {
              return (
                <li key={s.id} className="py-sm">
                  <SupplierForm
                    mode="inline"
                    initial={{
                      name: s.name,
                      phone: s.phone,
                      contactName: s.contactName,
                      email: s.email,
                      notes: s.notes,
                      // A pre-existing supplier with no primary category opens
                      // with the field empty and required — it can't be saved
                      // until one is chosen.
                      primaryCategoryId: s.primaryCategoryId ?? "",
                    }}
                    categories={data.categories}
                    onSubmit={(draft) => writes.updateSupplier(s.id, draft)}
                    onClose={() => rows.setEditingId(null)}
                    onNeedCategory={() => go({ view: "categories" })}
                  />
                </li>
              );
            }
            const productCount = productsOf(data.products, s.id).length;
            const primary = s.primaryCategoryId ? categoryName.get(s.primaryCategoryId) : undefined;
            return (
              <li key={s.id} className="flex items-center gap-sm py-sm">
                <div className="flex min-w-0 flex-1 flex-col gap-2xs">
                  <div className="flex items-baseline justify-between gap-sm">
                    <span className="min-w-0 truncate type-heading text-ink">{s.name}</span>
                    {s.phone ? (
                      // Phone numbers read left-to-right even in Hebrew.
                      <span dir="ltr" className="shrink-0 type-label text-muted">
                        {s.phone}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-xs type-label text-muted">
                    {primary ? (
                      <span>{primary}</span>
                    ) : (
                      <span className="rounded-pill bg-danger/10 px-xs py-2xs type-caption text-danger">
                        {t("orders.noPrimaryCategory")}
                      </span>
                    )}
                    <span aria-hidden="true">·</span>
                    <span>{count(productCount, "orders.productsOne", "orders.productsMany")}</span>
                  </div>
                </div>
                <RowActions
                  onEdit={() => {
                    rows.setConfirmId(null);
                    rows.setEditingId(s.id);
                  }}
                  confirming={rows.confirmId === s.id}
                  onArmDelete={() => rows.setConfirmId(s.id)}
                  onConfirmDelete={() => {
                    rows.setConfirmId(null);
                    rows.setWriteError(null);
                    void writes.deleteSupplier(s.id).then((code) => rows.setWriteError(code));
                  }}
                  // Deleting a supplier cascades its products — say so.
                  confirmLabel={
                    productCount > 0
                      ? t("orders.confirmDeleteWithProducts").replace("{count}", String(productCount))
                      : t("orders.confirmDelete")
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function NotFound() {
  const { t } = useI18n();
  return (
    <>
      <ToolHeader title={t("orders.name")} />
      <EmptyCard titleKey="orders.notFoundTitle" hintKey="orders.notFoundHint" />
    </>
  );
}
