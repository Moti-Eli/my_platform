"use client";

/**
 * The list's floating bar — the orders bar's chrome (translucent card, backdrop
 * blur), held by ListScreen's bottom dock (`sticky bottom-sm` + `mt-auto`), in
 * the tool's amber. It is the list's main place for actions. At rest:
 *
 *   ☰  menu    — opens above the bar: Rename list, Delete list (moved here from
 *                the header).
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
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { CheckIcon, CloseIcon, MenuIcon, PlusIcon, SearchIcon } from "@/components/icons";
import { ITEM_NAME_MAX, QUANTITY_MAX } from "../logic";

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

/** 🔍 · field · ✕ — the bar as the search row (filters the list as you type). */
function SearchRow({
  value,
  onChange,
  onClose,
}: {
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
        placeholder={t("shopping.searchPlaceholder")}
        aria-label={t("shopping.search")}
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
