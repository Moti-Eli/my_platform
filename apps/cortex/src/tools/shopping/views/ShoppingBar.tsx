"use client";

/**
 * The list's floating bar — the orders bar's chrome (translucent card, backdrop
 * blur), held by ListScreen's bottom dock (`sticky bottom-sm` + `mt-auto`), in
 * the tool's amber. It is the list's main place for actions. At rest:
 *
 *   ☰  menu    — opens above the bar: Rename list, List type (while types are
 *                available), Delete list.
 *   ＋  add     — the bar itself turns into the add row: ✕ · name · quantity · +.
 *                It stays open until ✕, so items go in one after another (Enter
 *                adds too; the fields clear and focus returns to the name).
 *   🔍 search  — the bar turns into a search field filtering the list; ✕ clears
 *                it and folds back.
 *   ✓  bought  — shows / hides the "Bought" section, with how many are in it.
 *
 * Width: the rest bar hugs its buttons (`w-fit`, as in orders); the add and
 * search rows take `w-[min(100%,28rem)]`. NOT `w-full max-w-md`: in this design
 * system `md` is also a spacing step, so `max-w-md` resolves to 16px and crushed
 * the name field (the same trap the tasks form documents).
 *
 * The menu closes on any tap outside it or Escape — a document listener, not a
 * full-screen `fixed` scrim: backdrop-blur makes the bar the containing block
 * for fixed children, so such a scrim would cover only the bar.
 */
import { useEffect, useRef, useState, type SVGProps } from "react";
import { createPortal } from "react-dom";
import { useI18n, type MessageKey } from "@/i18n";
import { CheckIcon, CloseIcon, MenuIcon, PlusIcon, SearchIcon } from "@/components/icons";
import { ITEM_NAME_MAX, QUANTITY_MAX, type ListType } from "../logic";
import { typeColorClasses } from "../typeColors";
import { NewTypeModal, TypeDot } from "./TypeViews";

type Mode = "rest" | "add" | "search";

const capsule =
  "flex shrink-0 items-center gap-2xs rounded-pill border border-hairline bg-card/70 p-2xs shadow-lifted backdrop-blur-md";
const iconButton =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full interactive motion-safe:active:scale-[0.97]";

export function ShoppingBar({
  onAdd,
  search,
  onSearchChange,
  boughtCount,
  showBought,
  onToggleBought,
  onRename,
  onDelete,
  onSetType,
}: {
  /** Resolves true when the item was added (the fields then clear). */
  onAdd: (draft: { name: string; quantity: string }) => Promise<boolean>;
  search: string;
  onSearchChange: (next: string) => void;
  boughtCount: number;
  showBought: boolean;
  onToggleBought: () => void;
  onRename: () => void;
  onDelete: () => void;
  /** "List type" in the menu — omitted while types are unavailable. */
  onSetType?: () => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>(search !== "" ? "search" : "rest");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  if (mode === "add") return <AddRow onAdd={onAdd} onClose={() => setMode("rest")} />;

  if (mode === "search") {
    return (
      <SearchRow
        placeholderKey="shopping.searchPlaceholder"
        value={search}
        onChange={onSearchChange}
        onClose={() => {
          onSearchChange("");
          setMode("rest");
        }}
      />
    );
  }

  return (
    <div className={`${capsule} w-fit`}>
      <div ref={menuRef} className="relative">
        {menuOpen ? (
          <div
            role="menu"
            className="absolute bottom-full start-0 z-50 mb-xs flex min-w-max flex-col rounded-lg border border-hairline bg-card p-2xs shadow-lifted"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onRename();
              }}
              className="rounded-md px-sm py-xs text-start type-label text-ink interactive"
            >
              {t("shopping.renameList")}
            </button>
            {onSetType ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onSetType();
                }}
                className="rounded-md px-sm py-xs text-start type-label text-ink interactive"
              >
                {t("shopping.listType")}
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onDelete();
              }}
              className="rounded-md px-sm py-xs text-start type-label text-danger interactive"
            >
              {t("shopping.deleteList")}
            </button>
          </div>
        ) : null}
        <button
          type="button"
          aria-label={t("shopping.menu")}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className={`${iconButton} ${menuOpen ? "bg-app-amber/15 text-app-amber" : "text-muted"}`}
        >
          <MenuIcon width={18} height={18} />
        </button>
      </div>
      <span className="h-5 w-px shrink-0 bg-hairline" aria-hidden="true" />
      <button
        type="button"
        aria-label={t("shopping.addItem")}
        onClick={() => setMode("add")}
        className={`${iconButton} bg-app-amber text-on-fill`}
      >
        <PlusIcon width={18} height={18} />
      </button>
      <button
        type="button"
        aria-label={t("shopping.search")}
        onClick={() => setMode("search")}
        className={`${iconButton} text-muted`}
      >
        <SearchIcon width={18} height={18} />
      </button>
      <button
        type="button"
        aria-pressed={showBought}
        aria-label={t(showBought ? "shopping.hideBought" : "shopping.showBought")}
        disabled={boughtCount === 0}
        onClick={onToggleBought}
        className={`flex h-8 shrink-0 items-center gap-2xs rounded-pill px-sm type-label interactive motion-safe:active:scale-[0.97] ${
          boughtCount === 0
            ? "text-muted opacity-[var(--ds-disabled-opacity)]"
            : showBought
              ? "bg-app-amber/15 text-app-amber"
              : "text-muted"
        }`}
      >
        <CheckIcon width={16} height={16} aria-hidden />
        {t("shopping.boughtHeading")}
        <span dir="ltr">{boughtCount}</span>
      </button>
    </div>
  );
}

/** ✕ · name · quantity · + — the bar as the add row. */
function AddRow({
  onAdd,
  onClose,
}: {
  onAdd: (draft: { name: string; quantity: string }) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

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
    <form onSubmit={submit} className={`${capsule} w-[min(100%,28rem)]`}>
      <button
        type="button"
        aria-label={t("shopping.closeAdd")}
        onClick={onClose}
        className={`${iconButton} text-muted`}
      >
        <CloseIcon width={14} height={14} />
      </button>
      <input
        ref={nameRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("shopping.addItemPlaceholder")}
        aria-label={t("shopping.itemName")}
        maxLength={ITEM_NAME_MAX}
        className="min-w-0 flex-1 bg-transparent px-xs py-2xs type-label text-ink outline-none placeholder:text-muted"
      />
      <span className="h-5 w-px shrink-0 bg-hairline" aria-hidden="true" />
      <input
        type="text"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        placeholder={t("shopping.quantityPlaceholder")}
        aria-label={t("shopping.quantity")}
        maxLength={QUANTITY_MAX}
        className="w-16 shrink-0 bg-transparent px-xs py-2xs type-label text-ink outline-none placeholder:text-muted"
      />
      <button
        type="submit"
        aria-label={t("shopping.addItem")}
        disabled={submitting || name.trim() === ""}
        className={`${iconButton} bg-app-amber text-on-fill`}
      >
        <PlusIcon width={18} height={18} />
      </button>
    </form>
  );
}

/**
 * The floating bar on "My lists" — the same chrome as the list's bar:
 *
 *   🔍 search — the bar turns into a search row filtering the lists by name.
 *   🏷 types  — the bar turns into the types filter row: All / each of MY types
 *               / No type, and ＋ to create a type. Only while types are
 *               available (tables migrated); ✕ clears the filter.
 *
 * (No ☰ yet — nothing real to put in it; "manage types" would be its first
 * item once types can be renamed / removed.)
 */
export function ListsBar({
  search,
  onSearchChange,
  types,
  typeFilter,
  onTypeFilterChange,
}: {
  search: string;
  onSearchChange: (next: string) => void;
  /** The user's types, or null while types are unavailable — then no 🏷. */
  types: readonly ListType[] | null;
  typeFilter: TypeFilter;
  onTypeFilterChange: (next: TypeFilter) => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"rest" | "search" | "types">(
    search !== "" ? "search" : typeFilter !== "all" ? "types" : "rest",
  );

  if (mode === "search") {
    return (
      <SearchRow
        placeholderKey="shopping.searchListsPlaceholder"
        value={search}
        onChange={onSearchChange}
        onClose={() => {
          onSearchChange("");
          setMode("rest");
        }}
      />
    );
  }
  if (mode === "types" && types) {
    return (
      <TypeFilterRow
        types={types}
        value={typeFilter}
        onChange={onTypeFilterChange}
        onClose={() => {
          onTypeFilterChange("all");
          setMode("rest");
        }}
      />
    );
  }
  return (
    <div className={`${capsule} w-fit`}>
      <button
        type="button"
        aria-label={t("shopping.searchLists")}
        onClick={() => setMode("search")}
        className={`${iconButton} text-muted`}
      >
        <SearchIcon width={18} height={18} />
      </button>
      {types ? (
        <button
          type="button"
          aria-label={t("shopping.filterByType")}
          onClick={() => setMode("types")}
          className={`${iconButton} text-muted`}
        >
          <TagIcon width={18} height={18} />
        </button>
      ) : null}
    </div>
  );
}

/** "All" / one type / "No type" — the lists filter on "My lists". */
export type TypeFilter = "all" | "none" | string;

/**
 * ✕ · All · each type · No type · ＋ — the bar as the types filter row. The
 * chips scroll sideways when there are many; ＋ creates a type (NewTypeModal).
 */
function TypeFilterRow({
  types,
  value,
  onChange,
  onClose,
}: {
  types: readonly ListType[];
  value: TypeFilter;
  onChange: (next: TypeFilter) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  const chip = (active: boolean, filled: string) =>
    `flex h-8 shrink-0 items-center gap-2xs rounded-pill px-sm type-label interactive motion-safe:active:scale-[0.97] ${
      active ? filled : "text-ink"
    }`;

  return (
    <div className={`${capsule} w-[min(100%,28rem)]`}>
      <button
        type="button"
        aria-label={t("shopping.closeTypeFilter")}
        onClick={onClose}
        className={`${iconButton} text-muted`}
      >
        <CloseIcon width={14} height={14} />
      </button>
      <div role="radiogroup" aria-label={t("shopping.filterByType")} className="flex min-w-0 flex-1 gap-2xs overflow-x-auto">
        <button
          type="button"
          role="radio"
          aria-checked={value === "all"}
          onClick={() => onChange("all")}
          className={chip(value === "all", "bg-app-amber text-on-fill")}
        >
          {t("shopping.allTypes")}
        </button>
        {types.map((ty) => (
          <button
            key={ty.id}
            type="button"
            role="radio"
            aria-checked={value === ty.id}
            onClick={() => onChange(ty.id)}
            className={chip(value === ty.id, typeColorClasses(ty.color).filled)}
          >
            {value === ty.id ? null : <TypeDot color={ty.color} size="h-2.5 w-2.5" />}
            {ty.name}
          </button>
        ))}
        {types.length > 0 ? (
          <button
            type="button"
            role="radio"
            aria-checked={value === "none"}
            onClick={() => onChange("none")}
            className={chip(value === "none", typeColorClasses(null).filled)}
          >
            {t("shopping.noType")}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        aria-label={t("shopping.newType")}
        onClick={() => setCreating(true)}
        className={`${iconButton} bg-app-amber text-on-fill`}
      >
        <PlusIcon width={16} height={16} />
      </button>
      {/* PORTALLED out of the bar: its backdrop-blur would make it the
          containing block of the modal's `fixed inset-0` scrim. */}
      {creating && typeof document !== "undefined"
        ? createPortal(
            <NewTypeModal
              onClose={() => setCreating(false)}
              onCreated={(created) => {
                setCreating(false);
                onChange(created.id);
              }}
            />,
            document.body,
          )
        : null}
    </div>
  );
}

/** A tag (🏷) in the app icon set's style — stroke, currentColor. Local to the
 * tool: nothing else needs it yet. */
function TagIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable={false}
      {...props}
    >
      <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7a1 1 0 0 1 .7.3l7.6 7.6a1 1 0 0 1 0 1.4l-7.7 7.7a1 1 0 0 1-1.4 0l-7.6-7.6a1 1 0 0 1-.3-.7Z" />
      <circle cx="8" cy="8" r="1.4" />
    </svg>
  );
}

/** 🔍 · field · ✕ — the bar as a search row (filters as you type). */
function SearchRow({
  placeholderKey,
  value,
  onChange,
  onClose,
}: {
  placeholderKey: MessageKey;
  value: string;
  onChange: (next: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <label className={`${capsule} w-[min(100%,28rem)] ps-sm text-muted`}>
      <SearchIcon width={16} height={16} aria-hidden className="shrink-0" />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t(placeholderKey)}
        aria-label={t(placeholderKey)}
        className="min-w-0 flex-1 bg-transparent py-2xs type-label text-ink outline-none placeholder:text-muted"
      />
      <button
        type="button"
        aria-label={t("shopping.closeSearch")}
        onClick={onClose}
        className={`${iconButton} text-muted`}
      >
        <CloseIcon width={14} height={14} />
      </button>
    </label>
  );
}
