"use client";

/**
 * "My lists" — the tool's default screen (stage 2): every list the user is in,
 * across ALL their organizations (the ones they created and the ones shared
 * with them), by name. Each row shows how many items are left to buy; tapping
 * a row opens the list in place (no org switch). ＋ in the header creates one.
 *
 * TYPES (the user's own, decision 4A): each row carries its type's colour as a
 * stripe on its leading edge and the type's name under the list's; the
 * floating bar (ListsBar) has 🔍 (search by name) and 🏷 (filter by type, or
 * "No type"). While types are unavailable (tables not migrated, or a read
 * error) the rows have no stripe and the bar no 🏷 — the lists always show.
 */
import { useState } from "react";
import { useI18n } from "@/i18n";
import { ChevronIcon } from "@/components/icons";
import { useShoppingLists } from "@/lib/query/useShoppingList";
import { useShoppingTypes } from "@/lib/query/useShoppingTypes";
import type { ListSummary, ListType } from "../logic";
import { typeColorClasses } from "../typeColors";
import { ListsBar, type TypeFilter } from "./ShoppingBar";
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
  const typesQ = useShoppingTypes();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  const needle = search.trim().toLocaleLowerCase(locale);
  const matchesType = (l: ListSummary) => {
    if (!typesQ.available || typeFilter === "all") return true;
    const type = typesQ.typeOf(l.id);
    return typeFilter === "none" ? type === null : type?.id === typeFilter;
  };
  const visible = lists.filter(
    (l) => (needle === "" || l.name.toLocaleLowerCase(locale).includes(needle)) && matchesType(l),
  );

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
        <p className="py-sm type-label text-muted">
          {t(needle === "" && typeFilter !== "all" ? "shopping.noListsOfType" : "shopping.noListMatches")}
        </p>
      ) : (
        <ul className="flex flex-col gap-xs">
          {visible.map((l) => (
            <li key={l.id}>
              <ListRow
                list={l}
                // undefined = types unavailable (no stripe); null = no type.
                type={typesQ.available ? typesQ.typeOf(l.id) : undefined}
                onOpen={() => onOpen(l.id)}
              />
            </li>
          ))}
        </ul>
      )}

      {/* The bottom dock — the list screen's `sticky bottom-sm` + `mt-auto`. */}
      <div className="sticky bottom-sm z-40 mt-auto flex shrink-0 flex-col items-center gap-xs">
        <ListsBar
          search={search}
          onSearchChange={setSearch}
          types={typesQ.available ? typesQ.types : null}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
        />
      </div>
    </>
  );
}

function ListRow({
  list,
  type,
  onOpen,
}: {
  list: ListSummary;
  /** The user's type for it; null = none; undefined = types unavailable. */
  type: ListType | null | undefined;
  onOpen: () => void;
}) {
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
      className="flex w-full items-stretch gap-sm rounded-lg bg-card px-md py-sm text-start interactive motion-safe:active:scale-[0.99]"
    >
      {type !== undefined ? (
        // The type's colour as a stripe on the leading edge.
        <span aria-hidden="true" className={`w-1 shrink-0 rounded-pill ${typeColorClasses(type?.color).dot}`} />
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate type-heading text-ink">{list.name}</span>
        <span className="flex min-w-0 items-center gap-xs">
          <span className={`truncate type-label ${list.toBuy > 0 ? "text-app-amber" : "text-muted"}`}>
            {status}
          </span>
          {type ? (
            <span className={`shrink-0 rounded-pill px-xs type-caption ${typeColorClasses(type.color).chip}`}>
              {type.name}
            </span>
          ) : null}
        </span>
      </span>
      {/* A "forward" chevron: it points left in RTL, right in LTR. */}
      <ChevronIcon
        width={16}
        height={16}
        aria-hidden
        className="shrink-0 self-center text-muted"
        style={{ transform: dir === "rtl" ? undefined : "scaleX(-1)" }}
      />
    </button>
  );
}
