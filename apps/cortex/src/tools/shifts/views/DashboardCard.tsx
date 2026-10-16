"use client";

/**
 * Shifts dashboard card — SIMPLE version for stage 1, part 1: the positions list
 * with a quick-add "+". The final card (today's shifts; "+" adds a shift for
 * today) replaces this in part 5.
 *
 * Same frame as the orders/tasks cards: fixed ~1/3 of the visible viewport
 * (`--app-vh`), the list scrolls inside, explicit loading / empty / error
 * states. Home wraps the card in a `<Link>`, so every control here calls BOTH
 * `preventDefault` and `stopPropagation` (see the tasks card for why).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { runIntentAction } from "@/cortex/actions";
import { CheckIcon, GridIcon, PlusIcon } from "@/components/icons";
import type { Position } from "../logic";
import { POSITION_NAME_MAX } from "../intents";
import {
  SHIFT_POSITIONS_KEY,
  sortPositions,
  useShiftPositions,
} from "@/lib/query/useShiftPositions";
import { SKELETON, useCountLabel, useMounted, type WriteErrorCode } from "./shared";

export function DashboardCard(_props: ToolViewProps) {
  const { t, locale } = useI18n();
  const count = useCountLabel();
  const queryClient = useQueryClient();
  const { positions: raw, isLoading: loading, isError: error } = useShiftPositions();
  const positions = sortPositions(raw, locale);
  const mounted = useMounted();

  const [quickAdding, setQuickAdding] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [quickError, setQuickError] = useState<WriteErrorCode | "exists" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (quickAdding) inputRef.current?.focus();
  }, [quickAdding]);

  const submitQuickAdd = useCallback(async () => {
    const clean = name.replace(/\s+/g, " ").trim();
    if (clean === "" || submitting) return;
    if (positions.some((p) => p.name.localeCompare(clean, locale, { sensitivity: "base" }) === 0)) {
      setQuickError("exists");
      return;
    }
    setSubmitting(true);
    setQuickError(null);
    try {
      const nextPosition = positions.reduce((max, p) => Math.max(max, p.position + 1), 0);
      const res = await runIntentAction("shifts.create_position", {
        name: clean,
        position: nextPosition,
      });
      if (!mounted.current) return;
      if (res.ok) {
        const { id } = res.data as { id: string };
        queryClient.setQueryData<Position[]>(SHIFT_POSITIONS_KEY, (prev) => [
          ...(prev ?? []),
          { id, name: clean, position: nextPosition },
        ]);
        setName("");
        setQuickAdding(false);
      } else {
        setQuickError(res.code);
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }, [name, submitting, positions, locale, queryClient, mounted]);

  return (
    <div
      className="flex flex-col rounded-lg bg-card p-md"
      style={{ height: "calc(var(--app-vh, 100dvh) / 3)" }}
    >
      <div className="mb-sm flex shrink-0 items-center justify-between gap-xs">
        <div className="flex min-w-0 items-center gap-xs">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-app-coral/15 text-app-coral">
            <GridIcon width={20} height={20} />
          </span>
          <span className="truncate type-heading text-ink">{t("shifts.name")}</span>
        </div>
        <div className="flex shrink-0 items-center gap-xs">
          {loading ? (
            <span className={`h-4 w-20 ${SKELETON}`} aria-hidden="true" />
          ) : error ? null : (
            <span className={`type-label ${positions.length > 0 ? "text-ink" : "text-muted"}`}>
              {count(positions.length, "shifts.positionsOne", "shifts.positionsMany")}
            </span>
          )}
          <button
            type="button"
            aria-label={t("shifts.addPosition")}
            aria-pressed={quickAdding}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setQuickError(null);
              setQuickAdding((v) => !v);
            }}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-app-coral text-on-fill interactive motion-safe:active:scale-[0.97]"
          >
            <PlusIcon width={16} height={16} />
          </button>
        </div>
      </div>

      {quickAdding ? (
        <form
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
            placeholder={t("shifts.positionPlaceholder")}
            maxLength={POSITION_NAME_MAX}
            disabled={submitting}
            className="min-w-0 flex-1 rounded-md bg-screen px-sm py-xs type-body text-ink outline-none placeholder:text-muted"
          />
          <button
            // `type="button"` — the form's onClick preventDefault would cancel a
            // submit button's own action (see the tasks card).
            type="button"
            aria-label={t("shifts.add")}
            disabled={submitting || name.trim() === ""}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void submitQuickAdd();
            }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-app-coral text-on-fill interactive motion-safe:active:scale-[0.97]"
          >
            <CheckIcon width={16} height={16} />
          </button>
        </form>
      ) : null}

      {quickError ? (
        <p role="alert" className="mb-sm shrink-0 type-caption text-danger">
          {t(
            quickError === "exists"
              ? "shifts.nameExists"
              : quickError === "failed"
                ? "shifts.errorFailed"
                : "shifts.errorDenied",
          )}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <ul className="flex flex-col divide-y divide-hairline" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="py-sm">
                <span className={`block h-4 w-28 ${SKELETON}`} />
              </li>
            ))}
          </ul>
        ) : error ? (
          <p className="type-label text-muted">{t("shifts.loadFailed")}</p>
        ) : positions.length > 0 ? (
          <ul className="flex flex-col divide-y divide-hairline">
            {positions.map((p) => (
              <li key={p.id} className="truncate py-sm type-body text-ink">
                {p.name}
              </li>
            ))}
          </ul>
        ) : (
          <p className="type-label text-muted">{t("shifts.emptyPositionsTitle")}</p>
        )}
      </div>
    </div>
  );
}
