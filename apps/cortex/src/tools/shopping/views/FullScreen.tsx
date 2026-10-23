"use client";

/**
 * Shopping full screen (Standard §2 `views/FullScreen.tsx`, §8).
 *
 * Every list lives in its own org (ARCHITECTURE.md #36), so the screen depends on
 * the ACTIVE org:
 *   - a list org     → the list (stage 1 step 1: its name only; the full list
 *                      screen comes next)
 *   - any other org  → "no list here" + "new list", which opens NewListModal
 */
import { useState } from "react";
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { useShoppingList } from "@/lib/query/useShoppingList";
import { NewListModal } from "./NewListModal";
import { AddButton, EmptyCard, SKELETON, ToolHeader } from "./shared";

// userId/orgId arrive as props but are NOT sent to the action — the server
// derives identity from the session cookie.
export function FullScreen(_props: ToolViewProps) {
  const { t } = useI18n();
  const { list, isLoading, isError } = useShoppingList();
  const [creating, setCreating] = useState(false);

  return (
    <>
      <ToolHeader
        title={list ? list.name : t("shopping.name")}
        subtitle={list ? t("shopping.name") : undefined}
      />

      {creating ? <NewListModal onClose={() => setCreating(false)} /> : null}

      {isLoading ? (
        <div className={`h-32 w-full ${SKELETON}`} aria-hidden="true" />
      ) : isError ? (
        <EmptyCard titleKey="shopping.loadFailed" />
      ) : list ? null : (
        <EmptyCard
          titleKey="shopping.noListTitle"
          hintKey="shopping.noListHint"
          action={<AddButton label={t("shopping.newList")} onClick={() => setCreating(true)} />}
        />
      )}
    </>
  );
}
