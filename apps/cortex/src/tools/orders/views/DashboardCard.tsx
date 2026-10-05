"use client";

/**
 * Orders dashboard card (Standard §2 `views/DashboardCard.tsx`, §8). Cloned from
 * Tasks' card, on the app-green identity accent. Stage 1: suppliers.
 *
 * STATES, MODELLED EXPLICITLY: loading → skeleton; loaded with suppliers → the
 * full list scrolling INSIDE the card; loaded empty → an explicit empty line;
 * error → a short muted "couldn't load" line, never silently blank.
 *
 * Reads through the SHARED react-query cache (`useSuppliersList`) — the SAME
 * cache the full screen uses — and the quick-add writes back into it.
 *
 * FIXED HEIGHT (~1/3 of the visible viewport) from `--app-vh`, exactly as the
 * tasks card does (see its header for why not bare `dvh`).
 *
 * QUICK ADD: name only — the fast path. Phone/contact/email/notes are filled in
 * from the full screen. Home wraps this card in a `<Link>`, so every control here
 * calls BOTH `preventDefault` (what actually stops the ancestor `<a>`) and
 * `stopPropagation` — see the tasks card for the full reasoning.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { runIntentAction, type IntentResult } from "@/cortex/actions";
import { CheckIcon, PlusIcon, SendIcon } from "@/components/icons";
import { useSuppliersList, SUPPLIERS_LIST_KEY } from "@/lib/query/useSuppliersList";
import type { Supplier } from "../logic";
import { SUPPLIER_LIMITS } from "../intents";
import { sortSuppliers } from "../sortSuppliers";

/** The failure codes a write can come back with (from {@link IntentResult}). */
type WriteErrorCode = Extract<IntentResult, { ok: false }>["code"];

/** Muted placeholder block (token colour; static for reduced-motion users). */
const SKELETON = "rounded-md bg-hairline motion-safe:animate-pulse";

// userId/orgId arrive as props but are never sent anywhere: the server action
// derives identity from the session cookie.
export function DashboardCard(_props: ToolViewProps) {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const { suppliers, isLoading: loading, isError: error } = useSuppliersList();
  const sorted = sortSuppliers(suppliers, "name", locale);

  const [quickAdding, setQuickAdding] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [quickError, setQuickError] = useState<WriteErrorCode | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Guards the async setState below (the card can unmount mid-submit).
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (quickAdding) inputRef.current?.focus();
  }, [quickAdding]);

  const submitQuickAdd = useCallback(async () => {
    const nextName = name.trim();
    if (nextName === "" || submitting) return;
    setSubmitting(true);
    setQuickError(null);
    try {
      const res = await runIntentAction("orders.create_supplier", { name: nextName });
      if (!mounted.current) return;
      if (res.ok) {
        // create_supplier returns { id, createdAt }; the rest of the row is what
        // was submitted (everything else defaults to ''), so append it straight
        // into the SHARED cache — no refetch.
        const { id, createdAt } = res.data as { id: string; createdAt: string };
        const created: Supplier = {
          id,
          name: nextName,
          phone: "",
          contactName: "",
          email: "",
          notes: "",
          createdAt,
        };
        queryClient.setQueryData<Supplier[]>(SUPPLIERS_LIST_KEY, (prev) => [
          ...(prev ?? []),
          created,
        ]);
        setName("");
        setQuickAdding(false);
      } else {
        setQuickError(res.code);
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }, [name, submitting, queryClient]);

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
            <span className={`type-label ${suppliers.length > 0 ? "text-ink" : "text-muted"}`}>
              {`${suppliers.length} ${t("orders.supplierCount")}`}
            </span>
          )}
          <button
            type="button"
            aria-label={t("orders.addSupplier")}
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
            onChange={(e) => setName(e.target.value)}
            placeholder={t("orders.namePlaceholder")}
            maxLength={SUPPLIER_LIMITS.name}
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
          {t(quickError === "failed" ? "orders.errorFailed" : "orders.errorDenied")}
        </p>
      ) : null}

      {/* The scrolling region — the only part that grows past the fixed height. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <ul className="flex flex-col divide-y divide-hairline" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex items-center justify-between py-sm">
                <span className={`h-4 w-28 ${SKELETON}`} />
                <span className={`h-4 w-20 ${SKELETON}`} />
              </li>
            ))}
          </ul>
        ) : error ? (
          <p className="type-label text-muted">{t("orders.loadFailed")}</p>
        ) : sorted.length > 0 ? (
          <ul className="flex flex-col divide-y divide-hairline">
            {sorted.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-sm py-sm">
                <span className="min-w-0 flex-1 truncate type-body text-ink">{s.name}</span>
                {s.phone ? (
                  // Phone numbers read left-to-right even in Hebrew.
                  <span dir="ltr" className="shrink-0 type-label text-muted">
                    {s.phone}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="type-label text-muted">{t("orders.emptyTitle")}</p>
        )}
      </div>
    </div>
  );
}
