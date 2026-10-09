"use client";

/**
 * "People needed" — inside a shift's edit screen: every position, in the
 * positions' own order, with − count +. 0 means "not needed" and has no DB row.
 *
 * Each tap saves immediately (`shifts.set_requirement`), optimistically, with a
 * revert on a real failure. One write per position at a time — that position's
 * buttons are disabled while its write is in flight, so fast taps can't race.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { runIntentAction } from "@/cortex/actions";
import { MinusIcon, PlusIcon } from "@/components/icons";
import type { ShiftRequirement } from "../logic";
import { REQUIRED_MAX } from "../intents";
import { requiredCount } from "../staffing";
import { sortPositions, useShiftPositions } from "@/lib/query/useShiftPositions";
import { SHIFT_REQUIREMENTS_KEY, useShiftRequirements } from "@/lib/query/useShiftTemplates";
import { SKELETON, WriteErrorBanner, useMounted, type WriteErrorCode } from "./shared";

const stepButton =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-hairline text-ink interactive motion-safe:active:scale-[0.97]";

export function RequirementsEditor({
  templateId,
  onGoToPositions,
}: {
  templateId: string;
  onGoToPositions: () => void;
}) {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const mounted = useMounted();
  const positionsQ = useShiftPositions();
  const { requirements, isLoading, isError } = useShiftRequirements();
  const positions = sortPositions(positionsQ.positions, locale);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<WriteErrorCode | null>(null);

  async function setCount(positionId: string, count: number) {
    if (pending.has(positionId)) return;
    const snapshot = queryClient.getQueryData<ShiftRequirement[]>(SHIFT_REQUIREMENTS_KEY);
    setPending((prev) => new Set(prev).add(positionId));
    setError(null);

    // Optimistic: 0 drops the row; otherwise update it, or add a placeholder row
    // whose real id arrives with the server's answer.
    queryClient.setQueryData<ShiftRequirement[]>(SHIFT_REQUIREMENTS_KEY, (prev) => {
      const list = prev ?? [];
      const match = (r: ShiftRequirement) => r.templateId === templateId && r.positionId === positionId;
      if (count === 0) return list.filter((r) => !match(r));
      if (list.some(match)) return list.map((r) => (match(r) ? { ...r, requiredCount: count } : r));
      return [...list, { id: `pending:${positionId}`, templateId, positionId, requiredCount: count }];
    });

    try {
      const res = await runIntentAction("shifts.set_requirement", { templateId, positionId, count });
      if (res.ok) {
        const { id } = res.data as { id: string | null };
        if (id) {
          queryClient.setQueryData<ShiftRequirement[]>(SHIFT_REQUIREMENTS_KEY, (prev) =>
            (prev ?? []).map((r) => (r.id === `pending:${positionId}` ? { ...r, id } : r)),
          );
        }
      } else {
        queryClient.setQueryData<ShiftRequirement[]>(SHIFT_REQUIREMENTS_KEY, snapshot);
        if (mounted.current) setError(res.code);
      }
    } finally {
      if (mounted.current)
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(positionId);
          return next;
        });
    }
  }

  return (
    <div className="flex flex-col gap-sm rounded-lg bg-card p-md">
      <span className="type-heading text-ink">{t("shifts.reqTitle")}</span>
      <WriteErrorBanner code={error} />

      {isLoading || positionsQ.isLoading ? (
        <div className={`h-24 ${SKELETON}`} aria-hidden="true" />
      ) : isError || positionsQ.isError ? (
        <p className="type-label text-muted">{t("shifts.loadFailed")}</p>
      ) : positions.length === 0 ? (
        <div className="flex flex-col items-start gap-xs">
          <p className="type-label text-muted">{t("shifts.reqNoPositions")}</p>
          <button
            type="button"
            onClick={onGoToPositions}
            className="rounded-pill bg-app-coral px-sm py-2xs type-caption text-on-fill interactive motion-safe:active:scale-[0.97]"
          >
            {t("shifts.reqGoToPositions")}
          </button>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline">
          {positions.map((p) => {
            const count = requiredCount(requirements, templateId, p.id);
            const busy = pending.has(p.id);
            return (
              <li key={p.id} className="flex items-center gap-sm py-xs">
                <span
                  className={`min-w-0 flex-1 truncate type-body ${count > 0 ? "text-ink" : "text-muted"}`}
                >
                  {p.name}
                </span>
                {/* LTR so − stays left of the number and + right of it. */}
                <div dir="ltr" className="flex shrink-0 items-center gap-xs">
                  <button
                    type="button"
                    aria-label={`${t("shifts.decrease")}: ${p.name}`}
                    disabled={busy || count === 0}
                    onClick={() => void setCount(p.id, count - 1)}
                    className={`${stepButton} ${count === 0 ? "opacity-[var(--ds-disabled-opacity)]" : ""}`}
                  >
                    <MinusIcon width={14} height={14} />
                  </button>
                  <span
                    aria-live="polite"
                    className={`w-6 text-center type-heading ${count > 0 ? "text-app-coral" : "text-muted"}`}
                  >
                    {count}
                  </span>
                  <button
                    type="button"
                    aria-label={`${t("shifts.increase")}: ${p.name}`}
                    disabled={busy || count >= REQUIRED_MAX}
                    onClick={() => void setCount(p.id, count + 1)}
                    className={stepButton}
                  >
                    <PlusIcon width={14} height={14} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
