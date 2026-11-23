"use client";

/**
 * Shopping full screen (Standard §2 `views/FullScreen.tsx`, §8).
 *
 * Every list lives in its own org (ARCHITECTURE.md #38), but the screen no
 * longer depends on the ACTIVE org (stage 2):
 *   - (default)    → "My lists": every list the user is in, across their orgs,
 *                    with ＋ (new list) in the header
 *   - ?list=<id>   → that list, opened in place — no org switch, no reload; its
 *                    actions live in the floating bar (ShoppingBar)
 */
import { useState } from "react";
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { useShoppingListById } from "@/lib/query/useShoppingList";
import { useShoppingNav } from "../nav";
import { ListScreen } from "./ListScreen";
import { MyListsScreen } from "./MyListsScreen";
import { NewListModal } from "./NewListModal";
import { EmptyCard, IconAddButton, SKELETON, ToolHeader } from "./shared";

// userId/orgId arrive as props but are NOT sent to the action — the server
// derives identity from the session cookie.
export function FullScreen(_props: ToolViewProps) {
  const { t } = useI18n();
  const { listId, openList } = useShoppingNav();
  const [creating, setCreating] = useState(false);

  return (
    <>
      {listId ? (
        // Keyed by the list, so per-list state (search, open rows) resets.
        <OpenList key={listId} listId={listId} />
      ) : (
        <>
          <ToolHeader
            title={t("shopping.myListsTitle")}
            subtitle={t("shopping.name")}
            action={<IconAddButton label={t("shopping.newList")} onClick={() => setCreating(true)} />}
          />
          <MyListsScreen onOpen={openList} onCreate={() => setCreating(true)} />
        </>
      )}

      {creating ? (
        <NewListModal
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            openList(id);
          }}
        />
      ) : null}
    </>
  );
}

/** One list, by id: its header and the list screen. */
function OpenList({ listId }: { listId: string }) {
  const { t } = useI18n();
  const { list, isLoading, isError } = useShoppingListById(listId);

  return (
    <>
      <ToolHeader title={list ? list.name : t("shopping.name")} subtitle={list ? t("shopping.name") : undefined} />
      {isLoading ? (
        <div className={`h-32 w-full ${SKELETON}`} aria-hidden="true" />
      ) : isError ? (
        <EmptyCard titleKey="shopping.loadFailed" />
      ) : list ? (
        <ListScreen list={list} />
      ) : (
        <EmptyCard titleKey="shopping.listNotFoundTitle" hintKey="shopping.listNotFoundHint" />
      )}
    </>
  );
}
