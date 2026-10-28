"use client";

/**
 * The list screen (stage 1, items part): the items still to buy, then — under
 * their own heading — the items already checked off. Rows follow orders'
 * product rows: the circle + name ticks / unticks the item; ✎ edits it inline;
 * ✕ is a two-tap delete. The floating add bar sits in the bottom dock.
 *
 * Every write reconciles the shared items cache with `setQueryData`. Ticking is
 * optimistic (the row moves at once) and is put back if the write fails.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { runIntentAction } from "@/cortex/actions";
import { CheckIcon } from "@/components/icons";
import { SHOPPING_ITEMS_KEY, useShoppingItems } from "@/lib/query/useShoppingItems";
import type { Item, List } from "../logic";
import { AddItemBar } from "./AddItemBar";
import { ItemForm } from "./ItemForm";
import { EmptyCard, RowActions, SKELETON, WriteErrorBanner, type WriteErrorCode } from "./shared";

export function ListScreen({ list }: { list: List }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { toBuy, bought, isLoading, isError } = useShoppingItems();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<WriteErrorCode | null>(null);

  const patchCache = (fn: (prev: Item[]) => Item[]) =>
    queryClient.setQueryData<Item[]>(SHOPPING_ITEMS_KEY, (prev) => fn(prev ?? []));

  async function addItem(draft: { name: string; quantity: string }): Promise<boolean> {
    setWriteError(null);
    const res = await runIntentAction("shopping.add_item", { listId: list.id, ...draft });
    if (!res.ok) {
      setWriteError(res.code);
      return false;
    }
    const { id, createdAt } = res.data as { id: string; createdAt: string };
    patchCache((prev) => [...prev, { id, ...draft, checked: false, createdAt }]);
    return true;
  }

  async function updateItem(
    id: string,
    draft: { name: string; quantity: string },
  ): Promise<WriteErrorCode | null> {
    const res = await runIntentAction("shopping.update_item", { id, ...draft });
    if (!res.ok) return res.code;
    patchCache((prev) => prev.map((i) => (i.id === id ? { ...i, ...draft } : i)));
    return null;
  }

  async function toggle(item: Item) {
    setWriteError(null);
    const checked = !item.checked;
    patchCache((prev) => prev.map((i) => (i.id === item.id ? { ...i, checked } : i)));
    const res = await runIntentAction("shopping.set_checked", { id: item.id, checked });
    if (!res.ok) {
      patchCache((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, checked: item.checked } : i)),
      );
      setWriteError(res.code);
    }
  }

  async function deleteItem(id: string) {
    setConfirmId(null);
    setWriteError(null);
    const res = await runIntentAction("shopping.delete_item", { id });
    if (!res.ok) {
      setWriteError(res.code);
      return;
    }
    patchCache((prev) => prev.filter((i) => i.id !== id));
  }

  function row(item: Item) {
    if (editingId === item.id) {
      return (
        <li key={item.id} className="py-sm">
          <ItemForm
            initial={{ name: item.name, quantity: item.quantity }}
            onSubmit={(draft) => updateItem(item.id, draft)}
            onClose={() => setEditingId(null)}
          />
        </li>
      );
    }
    return (
      <li key={item.id} className="flex items-center gap-sm py-sm">
        {/* The whole row (circle + name) ticks / unticks; ✎ and ✕ stay separate. */}
        <button
          type="button"
          aria-pressed={item.checked}
          aria-label={`${t(item.checked ? "shopping.uncheckItem" : "shopping.checkItem")}: ${item.name}`}
          onClick={() => void toggle(item)}
          className="flex min-w-0 flex-1 items-center gap-sm text-start interactive"
        >
          <span
            aria-hidden="true"
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
              item.checked ? "bg-app-amber text-on-fill" : "border-2 border-hairline"
            }`}
          >
            {item.checked ? <CheckIcon width={14} height={14} /> : null}
          </span>
          <span
            className={`min-w-0 flex-1 truncate type-heading ${
              item.checked ? "text-muted line-through" : "text-ink"
            }`}
          >
            {item.name}
          </span>
          {item.quantity ? (
            <span className="shrink-0 type-label text-muted">{item.quantity}</span>
          ) : null}
        </button>
        <RowActions
          onEdit={() => {
            setConfirmId(null);
            setEditingId(item.id);
          }}
          confirming={confirmId === item.id}
          onArmDelete={() => setConfirmId(item.id)}
          onConfirmDelete={() => void deleteItem(item.id)}
        />
      </li>
    );
  }

  return (
    <>
      <WriteErrorBanner code={writeError} />

      {isLoading ? (
        <ul className="flex flex-col divide-y divide-hairline" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-sm py-sm">
              <span className={`h-6 w-6 rounded-full ${SKELETON}`} />
              <span className={`h-5 w-40 ${SKELETON}`} />
            </li>
          ))}
        </ul>
      ) : isError ? (
        <EmptyCard titleKey="shopping.loadFailed" />
      ) : toBuy.length === 0 && bought.length === 0 ? (
        <EmptyCard titleKey="shopping.emptyItemsTitle" hintKey="shopping.emptyItemsHint" />
      ) : (
        <>
          {toBuy.length > 0 ? (
            <ul className="flex flex-col divide-y divide-hairline">{toBuy.map(row)}</ul>
          ) : (
            <p className="py-sm type-label text-muted">{t("shopping.allBought")}</p>
          )}
          {bought.length > 0 ? (
            <section className="flex flex-col gap-2xs pt-md">
              <h2 className="type-label text-muted">{t("shopping.boughtHeading")}</h2>
              <ul className="flex flex-col divide-y divide-hairline">{bought.map(row)}</ul>
            </section>
          ) : null}
        </>
      )}

      {/* The bottom dock — orders' `sticky bottom-sm` + `mt-auto`. */}
      <div className="sticky bottom-sm z-40 mt-auto flex shrink-0 flex-col items-center gap-xs">
        <AddItemBar onAdd={addItem} />
      </div>
    </>
  );
}
