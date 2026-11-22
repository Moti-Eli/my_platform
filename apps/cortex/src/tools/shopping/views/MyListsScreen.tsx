"use client";

/**
 * "My lists" — the tool's default screen (stage 2): every list the user is in,
 * across ALL their organizations (the ones they created and the ones shared
 * with them), by name. Each row shows how many items are left to buy; tapping
 * a row opens the list in place (no org switch). ＋ in the header creates one.
 * The floating bar (ListsBar, the list's bar chrome) searches the lists by name.
 */
import { useState } from "react";
import { useI18n } from "@/i18n";
import { ChevronIcon } from "@/components/icons";
import { useShoppingLists } from "@/lib/query/useShoppingList";
import type { ListSummary } from "../logic";
import { ListsBar } from "./ShoppingBar";
import { AddButton, EmptyCard, SKELETON } from "./shared";

export function MyListsScreen({
  onOpen,
  onCreate,
}: {
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const { t, locale } = useI18n();
  const { lists, isLoading, isError } = useShoppingLists();
  const [search, setSearch] = useState("");

  const needle = search.trim().toLocaleLowerCase(locale);
  const visible = needle === "" ? lists : lists.filter((l) => l.name.toLocaleLowerCase(locale).includes(needle));

  if (isLoading) {
    return (
      <ul className="flex flex-col gap-xs" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <li key={i} className={`h-16 ${SKELETON}`} />
        ))}
      </ul>
    );
  }
  if (isError) return <EmptyCard titleKey="shopping.loadFailed" />;
  if (lists.length === 0) {
    return (
      <EmptyCard
        titleKey="shopping.noListsTitle"
        hintKey="shopping.noListsHint"
        action={<AddButton label={t("shopping.newList")} onClick={onCreate} />}
      />
    );
  }

  return (
    <>
      {visible.length === 0 ? (
        <p className="py-sm type-label text-muted">{t("shopping.noListMatches")}</p>
      ) : (
        <ul className="flex flex-col gap-xs">
          {visible.map((l) => (
            <li key={l.id}>
              <ListRow list={l} onOpen={() => onOpen(l.id)} />
            </li>
          ))}
        </ul>
      )}

      {/* The bottom dock — the list screen's `sticky bottom-sm` + `mt-auto`. */}
      <div className="sticky bottom-sm z-40 mt-auto flex shrink-0 flex-col items-center gap-xs">
        <ListsBar search={search} onSearchChange={setSearch} />
      </div>
    </>
  );
}

function ListRow({ list, onOpen }: { list: ListSummary; onOpen: () => void }) {
  const { t, dir } = useI18n();
  const status =
    list.total === 0
      ? t("shopping.listEmpty")
      : list.toBuy === 0
        ? t("shopping.allBought")
        : list.toBuy === 1
          ? t("shopping.leftToBuyOne")
          : t("shopping.leftToBuyMany").replace("{count}", String(list.toBuy));

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-sm rounded-lg bg-card px-md py-sm text-start interactive motion-safe:active:scale-[0.99]"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate type-heading text-ink">{list.name}</span>
        <span className={`truncate type-label ${list.toBuy > 0 ? "text-app-amber" : "text-muted"}`}>
          {status}
        </span>
      </span>
      {/* A "forward" chevron: it points left in RTL, right in LTR. */}
      <ChevronIcon
        width={16}
        height={16}
        aria-hidden
        className="shrink-0 text-muted"
        style={{ transform: dir === "rtl" ? undefined : "scaleX(-1)" }}
      />
    </button>
  );
}
