"use client";

/**
 * Orders full screen (Standard §2 `views/FullScreen.tsx`, §8). Stage 1: the
 * supplier list. Cloned from Notes' list/edit/delete flow and Tasks' add modal +
 * floating bar, on the app-green identity accent.
 *
 * The read is the SHARED react-query cache (`useSuppliersList`) — the same entry
 * the dashboard card reads — and every write reconciles it via setQueryData (no
 * refetch). Writes go through the SERVER action (`runIntentAction`), which builds
 * ctx from the session; RLS (org-tree membership AND `orders.access`) gates every
 * row. Edits/deletes are OPTIMISTIC and revert on a real failure, which is surfaced
 * honestly — never faked and never swallowed.
 *
 * FLOATING BAR: same chrome as the tasks filter bar (pill, translucent card,
 * backdrop blur, hamburger at the edge). The hamburger SWAPS the bar between two
 * modes — "search" (filter by name) and "sort" (A–Z / newest) — each keeping its
 * own last value. Both are pure client-side narrowing/ordering of the cached list;
 * neither triggers a fetch.
 *
 * Built from design-system utilities + i18n only.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { runIntentAction, type IntentResult } from "@/cortex/actions";
import type { ToolViewProps } from "@/tools";
import { useI18n, type MessageKey } from "@/i18n";
import {
  ChevronIcon,
  CloseIcon,
  ComposeIcon,
  InfoIcon,
  MenuIcon,
  SearchIcon,
} from "@/components/icons";
import type { Supplier } from "../logic";
import { SUPPLIER_LIMITS } from "../intents";
import { sortSuppliers, type SupplierSort } from "../sortSuppliers";
import { useSuppliersList, SUPPLIERS_LIST_KEY } from "@/lib/query/useSuppliersList";

/** The failure codes a write can come back with (from {@link IntentResult}). */
type WriteErrorCode = Extract<IntentResult, { ok: false }>["code"];

/** The editable fields of a supplier — what the add modal and the inline edit
 * form both collect. Every value is already trimmed by the time it is saved. */
type SupplierDraft = Pick<Supplier, "name" | "phone" | "contactName" | "email" | "notes">;

const EMPTY_DRAFT: SupplierDraft = { name: "", phone: "", contactName: "", email: "", notes: "" };

function trimDraft(d: SupplierDraft): SupplierDraft {
  return {
    name: d.name.trim(),
    phone: d.phone.trim(),
    contactName: d.contactName.trim(),
    email: d.email.trim(),
    notes: d.notes.trim(),
  };
}

// userId/orgId arrive as props but are NOT sent to the action — the server
// derives identity from the session cookie.
export function FullScreen(_props: ToolViewProps) {
  const { t, dir, locale } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { suppliers, isLoading: loading, isError: loadError } = useSuppliersList();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<WriteErrorCode | null>(null);
  // The floating bar's two independent values (see file header).
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SupplierSort>("name");

  // Guards the async setState in the write callbacks (StrictMode-safe re-arm).
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // In-flight edits / deletes, keyed by supplier id — separate guards so a save
  // and a delete never share a lock. Refs are the synchronous source of truth.
  const savingRef = useRef<Set<string>>(new Set());
  const deletingRef = useRef<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<ReadonlySet<string>>(deletingRef.current);
  // Which row is mid two-tap delete confirm (null = none).
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const patchSupplier = useCallback(
    (id: string, patch: (it: Supplier) => Supplier) => {
      queryClient.setQueryData<Supplier[]>(SUPPLIERS_LIST_KEY, (prev) =>
        (prev ?? []).map((it) => (it.id === id ? patch(it) : it)),
      );
    },
    [queryClient],
  );

  const saveSupplier = useCallback(
    async (id: string, next: SupplierDraft) => {
      if (savingRef.current.has(id)) return;

      // Snapshot BEFORE editing, so a failure can restore it exactly.
      const prevList = queryClient.getQueryData<Supplier[]>(SUPPLIERS_LIST_KEY) ?? [];
      const prev = prevList.find((it) => it.id === id) ?? null;

      savingRef.current = new Set(savingRef.current).add(id);

      // OPTIMISTIC: write into the shared cache first (the card moves in lockstep).
      setWriteError(null);
      patchSupplier(id, (it) => ({ ...it, ...next }));

      try {
        const res = await runIntentAction("orders.update_supplier", { id, ...next });
        if (res.ok) {
          if (mounted.current) setEditingId((cur) => (cur === id ? null : cur));
        } else {
          // REVERT and surface the real error; the editor stays open.
          if (prev) patchSupplier(id, () => prev);
          if (mounted.current) setWriteError(res.code);
        }
      } finally {
        const cleared = new Set(savingRef.current);
        cleared.delete(id);
        savingRef.current = cleared;
      }
    },
    [patchSupplier, queryClient],
  );

  const removeSupplier = useCallback(
    async (id: string) => {
      if (deletingRef.current.has(id)) return;

      // Snapshot the row AND its index, so a failure restores it in place.
      const prevList = queryClient.getQueryData<Supplier[]>(SUPPLIERS_LIST_KEY) ?? [];
      const index = prevList.findIndex((it) => it.id === id);
      const removed = index >= 0 ? prevList[index] : null;

      const nextDeleting = new Set(deletingRef.current).add(id);
      deletingRef.current = nextDeleting;
      setDeleting(nextDeleting);

      // OPTIMISTIC: drop the row from the shared cache immediately.
      setWriteError(null);
      queryClient.setQueryData<Supplier[]>(SUPPLIERS_LIST_KEY, (prev) =>
        (prev ?? []).filter((it) => it.id !== id),
      );

      try {
        const res = await runIntentAction("orders.delete_supplier", { id });
        if (!res.ok) {
          if (removed) {
            queryClient.setQueryData<Supplier[]>(SUPPLIERS_LIST_KEY, (prev) => {
              const list = [...(prev ?? [])];
              list.splice(Math.min(index, list.length), 0, removed);
              return list;
            });
          }
          if (mounted.current) setWriteError(res.code);
        }
      } finally {
        const cleared = new Set(deletingRef.current);
        cleared.delete(id);
        deletingRef.current = cleared;
        if (mounted.current) setDeleting(cleared);
      }
    },
    [queryClient],
  );

  // Search narrows by name OR contact person (case-insensitive); sort orders the
  // result. Both run on the cached list only.
  const query = search.trim().toLocaleLowerCase(locale);
  const visible = sortSuppliers(
    query === ""
      ? suppliers
      : suppliers.filter(
          (s) =>
            s.name.toLocaleLowerCase(locale).includes(query) ||
            s.contactName.toLocaleLowerCase(locale).includes(query),
        ),
    sort,
    locale,
  );
  const searchHidesEverything = suppliers.length > 0 && visible.length === 0;

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
        <h1 className="flex-1 type-title text-ink">{t("orders.name")}</h1>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-pill bg-app-green px-md py-xs type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
        >
          {t("orders.addSupplier")}
        </button>
      </div>

      {writeError ? (
        <p
          role="alert"
          className="flex items-start gap-xs rounded-md bg-danger/10 px-sm py-xs type-label text-danger"
        >
          <InfoIcon width={18} height={18} aria-hidden className="mt-2xs shrink-0" />
          <span>
            {t(writeError === "failed" ? "orders.errorFailed" : "orders.errorDenied")}
          </span>
        </p>
      ) : null}

      {adding ? (
        <AddSupplierModal
          onCreated={(supplier) => {
            queryClient.setQueryData<Supplier[]>(SUPPLIERS_LIST_KEY, (prev) => [
              ...(prev ?? []),
              supplier,
            ]);
            setAdding(false);
            setWriteError(null);
          }}
          onError={(code) => setWriteError(code)}
          onClose={() => setAdding(false)}
        />
      ) : null}

      <div className="flex items-baseline gap-2xs">
        <span className="type-label text-muted">{t("orders.suppliersTitle")}</span>
        {loading || loadError ? null : (
          <span className="type-label text-muted">{suppliers.length}</span>
        )}
      </div>

      {loading ? null : loadError ? (
        <p className="type-label text-muted">{t("orders.loadFailed")}</p>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-xs rounded-lg bg-card px-lg py-2xl text-center">
          <p className="type-heading text-ink">
            {t(searchHidesEverything ? "orders.searchEmptyTitle" : "orders.emptyTitle")}
          </p>
          <p className="max-w-[24ch] type-label text-muted">
            {t(searchHidesEverything ? "orders.searchEmptyHint" : "orders.emptyHint")}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline">
          {visible.map((s) => {
            const rowDeleting = deleting.has(s.id);
            const confirming = confirmId === s.id;

            if (editingId === s.id) {
              return (
                <li key={s.id} className="py-sm">
                  <EditSupplierForm
                    supplier={s}
                    onSave={(next) => saveSupplier(s.id, next)}
                    onCancel={() => setEditingId(null)}
                  />
                </li>
              );
            }

            const secondary = [s.contactName, s.notes].filter((v) => v !== "").join(" · ");

            return (
              <li key={s.id} className="flex items-center gap-sm py-sm">
                <div className="flex min-w-0 flex-1 flex-col gap-2xs">
                  <div className="flex items-baseline justify-between gap-sm">
                    <span className="min-w-0 truncate type-heading text-ink">{s.name}</span>
                    {s.phone ? (
                      <span dir="ltr" className="shrink-0 type-label text-muted">
                        {s.phone}
                      </span>
                    ) : null}
                  </div>
                  {secondary ? (
                    <span className="truncate type-label text-muted">{secondary}</span>
                  ) : null}
                </div>

                <button
                  type="button"
                  aria-label={t("orders.edit")}
                  onClick={() => {
                    setConfirmId(null);
                    setEditingId(s.id);
                  }}
                  disabled={rowDeleting}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-hairline text-muted interactive motion-safe:active:scale-[0.97]"
                >
                  <ComposeIcon width={16} height={16} />
                </button>

                {/* Two-tap inline delete confirm (no modal, no window.confirm). */}
                {confirming ? (
                  <button
                    type="button"
                    aria-label={t("orders.confirmDelete")}
                    onClick={() => {
                      setConfirmId(null);
                      void removeSupplier(s.id);
                    }}
                    disabled={rowDeleting}
                    className="shrink-0 rounded-pill bg-danger px-sm py-2xs type-caption text-on-fill interactive motion-safe:active:scale-[0.97]"
                  >
                    {t("orders.confirmDelete")}
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label={t("orders.delete")}
                    onClick={() => setConfirmId(s.id)}
                    disabled={rowDeleting}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-hairline text-muted interactive motion-safe:active:scale-[0.97]"
                  >
                    <CloseIcon width={16} height={16} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <SupplierBar search={search} onSearchChange={setSearch} sort={sort} onSortChange={setSort} />
    </>
  );
}

/**
 * Floating search/sort bar — the tasks filter bar's chrome (`sticky bottom-sm` +
 * `mt-auto`, translucent card, backdrop blur; see its header for why sticky, not
 * fixed). The hamburger swaps between "search" and "sort" modes; switching mode
 * touches neither value, so each keeps its last setting.
 */
function SupplierBar({
  search,
  onSearchChange,
  sort,
  onSortChange,
}: {
  search: string;
  onSearchChange: (next: string) => void;
  sort: SupplierSort;
  onSortChange: (next: SupplierSort) => void;
}) {
  const { t } = useI18n();
  const [barMode, setBarMode] = useState<"search" | "sort">("search");
  const sortOptions: Array<{ key: SupplierSort; labelKey: MessageKey }> = [
    { key: "name", labelKey: "orders.sortByName" },
    { key: "newest", labelKey: "orders.sortByNewest" },
  ];

  return (
    <div className="sticky bottom-sm z-40 mt-auto flex w-fit shrink-0 items-center gap-2xs self-center rounded-pill border border-hairline bg-card/70 p-2xs shadow-lifted backdrop-blur-md">
      <button
        type="button"
        aria-label={t("orders.barMenu")}
        aria-pressed={barMode === "sort"}
        onClick={() => setBarMode((m) => (m === "search" ? "sort" : "search"))}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full interactive motion-safe:active:scale-[0.97] ${
          barMode === "sort" ? "bg-app-green/15 text-app-green" : "text-muted"
        }`}
      >
        <MenuIcon width={18} height={18} />
      </button>
      <span className="h-5 w-px shrink-0 bg-hairline" aria-hidden="true" />
      {barMode === "search" ? (
        <label className="flex items-center gap-2xs px-xs text-muted">
          <SearchIcon width={16} height={16} aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("orders.searchPlaceholder")}
            aria-label={t("orders.searchPlaceholder")}
            className="w-40 bg-transparent py-2xs type-label text-ink outline-none placeholder:text-muted"
          />
        </label>
      ) : (
        sortOptions.map((option) => {
          const active = sort === option.key;
          return (
            <button
              key={option.key}
              type="button"
              aria-pressed={active}
              onClick={() => onSortChange(option.key)}
              className={`rounded-pill px-sm py-2xs type-label interactive motion-safe:active:scale-[0.97] ${
                active ? "bg-app-green text-on-fill" : "text-muted"
              }`}
            >
              {t(option.labelKey)}
            </button>
          );
        })
      )}
    </div>
  );
}

const inputClass =
  "w-full rounded-md bg-screen px-sm py-sm type-body text-ink outline-none placeholder:text-muted";
const invalidRing = "ring-1 ring-danger";

/**
 * The five supplier inputs — shared by the add modal and the inline edit form so
 * the two can never drift. Owns no state; the parent form holds the draft.
 */
function SupplierFields({
  draft,
  onChange,
  nameInvalid,
  nameRef,
}: {
  draft: SupplierDraft;
  onChange: (next: SupplierDraft) => void;
  nameInvalid: boolean;
  nameRef?: React.Ref<HTMLInputElement>;
}) {
  const { t } = useI18n();
  const set = (key: keyof SupplierDraft) => (value: string) => onChange({ ...draft, [key]: value });

  return (
    <>
      <label className="flex flex-col gap-2xs type-label text-muted">
        <span>
          {t("orders.supplierName")} <span aria-hidden="true" className="text-danger">*</span>
        </span>
        <input
          ref={nameRef}
          className={nameInvalid ? `${inputClass} ${invalidRing}` : inputClass}
          value={draft.name}
          placeholder={t("orders.namePlaceholder")}
          maxLength={SUPPLIER_LIMITS.name}
          onChange={(e) => set("name")(e.target.value)}
          aria-required="true"
          aria-invalid={nameInvalid}
        />
        {nameInvalid ? (
          <span role="alert" className="type-caption text-danger">
            {t("orders.fieldRequired")}
          </span>
        ) : null}
      </label>
      <label className="flex flex-col gap-2xs type-label text-muted">
        {t("orders.phone")}
        <input
          type="tel"
          dir="ltr"
          className={inputClass}
          value={draft.phone}
          placeholder={t("orders.phonePlaceholder")}
          maxLength={SUPPLIER_LIMITS.phone}
          onChange={(e) => set("phone")(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-2xs type-label text-muted">
        {t("orders.contactName")}
        <input
          className={inputClass}
          value={draft.contactName}
          placeholder={t("orders.contactNamePlaceholder")}
          maxLength={SUPPLIER_LIMITS.contactName}
          onChange={(e) => set("contactName")(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-2xs type-label text-muted">
        {t("orders.email")}
        <input
          type="email"
          dir="ltr"
          className={inputClass}
          value={draft.email}
          placeholder={t("orders.emailPlaceholder")}
          maxLength={SUPPLIER_LIMITS.email}
          onChange={(e) => set("email")(e.target.value)}
        />
      </label>
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
    </>
  );
}

/**
 * Add-supplier MODAL — same overlay chrome and z-index reasoning as tasks'
 * AddTaskModal (scrim closes on tap / Escape; the panel stops propagation).
 */
function AddSupplierModal({
  onCreated,
  onError,
  onClose,
}: {
  onCreated: (supplier: Supplier) => void;
  onError: (code: WriteErrorCode) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<SupplierDraft>(EMPTY_DRAFT);
  const [nameInvalid, setNameInvalid] = useState(false);
  // True while an add is in flight — a second submit is a no-op, so a double-tap
  // can't write a duplicate supplier.
  const [submitting, setSubmitting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    const next = trimDraft(draft);
    // Visible validation: a blank name marks itself and says what is missing.
    if (next.name === "") {
      setNameInvalid(true);
      return;
    }

    setSubmitting(true);
    try {
      const res = await runIntentAction("orders.create_supplier", next);
      if (!mounted.current) return;
      if (res.ok) {
        const { id, createdAt } = res.data as { id: string; createdAt: string };
        onCreated({ id, createdAt, ...next });
      } else {
        onError(res.code);
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  return (
    <div
      className="ds-backdrop fixed inset-0 z-[70] flex items-center justify-center bg-scrim p-md"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="ds-panel flex max-h-full w-[min(100%,24rem)] flex-col gap-sm overflow-y-auto rounded-xl bg-card p-lg shadow-lifted"
      >
        <h2 className="type-heading text-ink">{t("orders.addSupplier")}</h2>
        <SupplierFields
          draft={draft}
          onChange={(next) => {
            setDraft(next);
            if (nameInvalid && next.name.trim() !== "") setNameInvalid(false);
          }}
          nameInvalid={nameInvalid}
          nameRef={nameRef}
        />
        <div className="flex gap-sm pt-xs">
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 rounded-md bg-app-green py-sm type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
          >
            {t("orders.add")}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 rounded-md bg-transparent py-sm type-label text-muted interactive motion-safe:active:scale-[0.97]"
          >
            {t("orders.cancel")}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Inline edit form — replaces a row in place; the write is delegated to `onSave`. */
function EditSupplierForm({
  supplier,
  onSave,
  onCancel,
}: {
  supplier: Supplier;
  onSave: (next: SupplierDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<SupplierDraft>({
    name: supplier.name,
    phone: supplier.phone,
    contactName: supplier.contactName,
    email: supplier.email,
    notes: supplier.notes,
  });
  const [nameInvalid, setNameInvalid] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    const next = trimDraft(draft);
    if (next.name === "") {
      setNameInvalid(true);
      return;
    }

    setSubmitting(true);
    try {
      await onSave(next);
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-sm rounded-lg bg-card p-md">
      <SupplierFields
        draft={draft}
        onChange={(next) => {
          setDraft(next);
          if (nameInvalid && next.name.trim() !== "") setNameInvalid(false);
        }}
        nameInvalid={nameInvalid}
      />
      <div className="flex items-center gap-sm">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 rounded-md bg-app-green py-sm type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
        >
          {t("orders.save")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-md bg-hairline px-md py-sm type-label text-ink interactive motion-safe:active:scale-[0.97]"
        >
          {t("orders.cancel")}
        </button>
      </div>
    </form>
  );
}
