"use client";

/**
 * Orders dashboard card (Standard §2 `views/DashboardCard.tsx`, §8). Cloned from
 * Tasks' card, on the app-green identity accent. Stage 2: CATEGORIES — the same
 * thing the tool's main screen shows (stage 3 will likely swap this for open
 * drafts / orders to do).
 *
 * STATES, MODELLED EXPLICITLY: loading → skeleton; loaded → the categories,
 * scrolling INSIDE the card; empty → an explicit line; error → a muted
 * "couldn't load" line, never silently blank.
 *
 * Reads the SAME shared caches as the full screen; supplier counts use the same
 * rule (`suppliersInCategory`), so the card and the tool never disagree.
 *
 * FIXED HEIGHT (~1/3 of the visible viewport) from `--app-vh`, exactly as the
 * tasks card does.
 *
 * TAPS: Home wraps this card in a `<Link>` to the tool's main screen. The "+"
 * quick-add and each category row call BOTH `preventDefault` (what actually stops
 * the ancestor `<a>`) and `stopPropagation`; a row then navigates itself, straight
 * INTO that category. Tapping anywhere else opens the main screen as before.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { CheckIcon, PlusIcon, SendIcon } from "@/components/icons";
import { useSuppliersList } from "@/lib/query/useSuppliersList";
import { useCategoriesList, useProductsList } from "@/lib/query/useOrdersCatalog";
import { CATEGORY_NAME_MAX } from "../intents";
import { byName, sameName, suppliersInCategory } from "../catalog";
import { ORDERS_ROUTE, ordersHref } from "../nav";
import { useOrdersWrites } from "./useOrdersWrites";
import { SKELETON, useCountLabel, useMounted, type WriteErrorCode } from "./shared";

// userId/orgId arrive as props but are never sent anywhere: the server action
// derives identity from the session cookie.
export function DashboardCard(_props: ToolViewProps) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const count = useCountLabel();
  const writes = useOrdersWrites();
  const suppliersQ = useSuppliersList();
  const categoriesQ = useCategoriesList();
  const productsQ = useProductsList();

  const loading = suppliersQ.isLoading || categoriesQ.isLoading || productsQ.isLoading;
  const error = suppliersQ.isError || categoriesQ.isError || productsQ.isError;
  const categories = byName(categoriesQ.categories, locale);

  const [quickAdding, setQuickAdding] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [quickError, setQuickError] = useState<WriteErrorCode | "exists" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mounted = useMounted();

  useEffect(() => {
    if (quickAdding) inputRef.current?.focus();
  }, [quickAdding]);

  const submitQuickAdd = useCallback(async () => {
    const nextName = name.trim();
    if (nextName === "" || submitting) return;
    if (categoriesQ.categories.some((c) => sameName(c.name, nextName, locale))) {
      setQuickError("exists");
      return;
    }
    setSubmitting(true);
    setQuickError(null);
    try {
      const { error: code } = await writes.createCategory(nextName);
      if (!mounted.current) return;
      if (code) {
        setQuickError(code);
      } else {
        setName("");
        setQuickAdding(false);
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }, [name, submitting, categoriesQ.categories, locale, writes, mounted]);

  return (
    <div
      className="flex flex-col rounded-lg bg-card p-md"
      style={{ height: "calc(var(--app-vh, 100dvh) / 3)" }}
    >
      <div className="mb-sm flex shrink-0 items-center justify-between gap-xs">
        <div className="flex min-w-0 items-center gap-xs">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-app-green/15 text-app-green">
            <SendIcon width={20} height={20} />
          </span>
          <span className="truncate type-heading text-ink">{t("orders.name")}</span>
        </div>
        <div className="flex shrink-0 items-center gap-xs">
          {loading ? (
            <span className={`h-4 w-20 ${SKELETON}`} aria-hidden="true" />
          ) : error ? null : (
            <span className={`type-label ${categories.length > 0 ? "text-ink" : "text-muted"}`}>
              {count(categories.length, "orders.categoriesOne", "orders.categoriesMany")}
            </span>
          )}
          <button
            type="button"
            aria-label={t("orders.addCategory")}
            aria-pressed={quickAdding}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setQuickError(null);
              setQuickAdding((v) => !v);
            }}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-app-green text-on-fill interactive motion-safe:active:scale-[0.97]"
          >
            <PlusIcon width={16} height={16} />
          </button>
        </div>
      </div>

      {quickAdding ? (
        <form
          // Catch-all for the input's own click bubbling to the ancestor `<a>`.
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onSubmit={(e) => {
            e.preventDefault();
            void submitQuickAdd();
          }}
          className="mb-sm flex shrink-0 items-center gap-xs"
        >
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (quickError === "exists") setQuickError(null);
            }}
            placeholder={t("orders.categoryPlaceholder")}
            maxLength={CATEGORY_NAME_MAX}
            disabled={submitting}
            className="min-w-0 flex-1 rounded-md bg-screen px-sm py-xs type-body text-ink outline-none placeholder:text-muted"
          />
          <button
            // `type="button"` — the form's onClick preventDefault would cancel a
            // submit button's own action (see the tasks card).
            type="button"
            aria-label={t("orders.add")}
            disabled={submitting || name.trim() === ""}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void submitQuickAdd();
            }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-app-green text-on-fill interactive motion-safe:active:scale-[0.97]"
          >
            <CheckIcon width={16} height={16} />
          </button>
        </form>
      ) : null}

      {quickError ? (
        <p role="alert" className="mb-sm shrink-0 type-caption text-danger">
          {t(
            quickError === "exists"
              ? "orders.nameExists"
              : quickError === "failed"
                ? "orders.errorFailed"
                : "orders.errorDenied",
          )}
        </p>
      ) : null}

      {/* The scrolling region — the only part that grows past the fixed height. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <ul className="flex flex-col divide-y divide-hairline" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex items-center justify-between py-sm">
                <span className={`h-4 w-28 ${SKELETON}`} />
                <span className={`h-4 w-16 ${SKELETON}`} />
              </li>
            ))}
          </ul>
        ) : error ? (
          <p className="type-label text-muted">{t("orders.loadFailed")}</p>
        ) : categories.length > 0 ? (
          <ul className="flex flex-col divide-y divide-hairline">
            {categories.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    router.push(
                      `${ORDERS_ROUTE}${ordersHref({ view: "category", categoryId: c.id })}`,
                    );
                  }}
                  className="flex w-full items-center justify-between gap-sm py-sm text-start interactive"
                >
                  <span className="min-w-0 flex-1 truncate type-body text-ink">{c.name}</span>
                  <span className="shrink-0 type-label text-muted">
                    {count(
                      suppliersInCategory(c.id, suppliersQ.suppliers, productsQ.products).length,
                      "orders.suppliersOne",
                      "orders.suppliersMany",
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="type-label text-muted">{t("orders.emptyCategoriesTitle")}</p>
        )}
      </div>
    </div>
  );
}
