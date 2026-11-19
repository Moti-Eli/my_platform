"use client";

/**
 * The plan screen: the plan's details (workouts per week, description — "Edit"
 * changes them and the name), then its training days. Each day row opens the
 * day; ↑/↓ reorder, ✎ edits (name + type), ✕ is a two-tap delete (the day's
 * exercises go with it, FK cascade). "Add day" sits under the list.
 *
 * Every write reconciles the shared days cache with `setQueryData`. Reordering
 * is optimistic (the row moves at once) and is put back if the write fails.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { runIntentAction } from "@/cortex/actions";
import { ComposeIcon } from "@/components/icons";
import { TRAINING_DAYS_KEY, useTrainingDays } from "@/lib/query/useTrainingDays";
import type { Day, Plan } from "../logic";
import { DAY_TYPE_KEY, DayModal, type DayDraft } from "./DayModal";
import { EditPlanModal } from "./PlanDialogs";
import {
  AddButton,
  EmptyCard,
  RowActions,
  SKELETON,
  WriteErrorBanner,
  matchesSearch,
  moved,
  useFrequencyLabel,
  type WriteErrorCode,
} from "./shared";

export function PlanScreen({
  plan,
  search,
  onOpenDay,
  dayMeta,
}: {
  plan: Plan;
  /** The bar's search text — filters the days by name. */
  search: string;
  onOpenDay: (dayId: string) => void;
  /** Optional extra line per day (e.g. its exercise count). */
  dayMeta?: (day: Day) => string | null;
}) {
  const { t } = useI18n();
  const frequencyLabel = useFrequencyLabel();
  const queryClient = useQueryClient();
  const { days, isLoading, isError } = useTrainingDays();
  const [editingPlan, setEditingPlan] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingDay, setEditingDay] = useState<Day | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<WriteErrorCode | null>(null);
  const freq = frequencyLabel(plan.frequencyPerWeek);

  const setDays = (fn: (prev: Day[]) => Day[]) =>
    queryClient.setQueryData<Day[]>(TRAINING_DAYS_KEY, (prev) => fn(prev ?? []));

  async function addDay(draft: DayDraft): Promise<WriteErrorCode | null> {
    const res = await runIntentAction("training.add_day", { planId: plan.id, ...draft });
    if (!res.ok) return res.code;
    const day = res.data as Day;
    setDays((prev) => [...prev, day]);
    return null;
  }

  async function updateDay(id: string, draft: DayDraft): Promise<WriteErrorCode | null> {
    const res = await runIntentAction("training.update_day", { id, ...draft });
    if (!res.ok) return res.code;
    setDays((prev) => prev.map((d) => (d.id === id ? { ...d, ...draft } : d)));
    return null;
  }

  async function deleteDay(id: string) {
    setConfirmId(null);
    setWriteError(null);
    const res = await runIntentAction("training.delete_day", { id });
    if (!res.ok) {
      setWriteError(res.code);
      return;
    }
    setDays((prev) => prev.filter((d) => d.id !== id));
  }

  async function move(index: number, step: -1 | 1) {
    const next = moved(days, index, step);
    if (!next) return;
    setWriteError(null);
    const before = days;
    setDays(() => next.map((d, i) => ({ ...d, sortOrder: i })));
    const res = await runIntentAction("training.reorder_days", { ids: next.map((d) => d.id) });
    if (!res.ok) {
      setDays(() => before);
      setWriteError(res.code);
    }
  }

  // Reordering a filtered list would be confusing — the arrows are off while
  // searching.
  const searching = search.trim() !== "";
  const shown = days.filter((d) => matchesSearch(d.name, search));

  return (
    <>
      {editingPlan ? <EditPlanModal plan={plan} onClose={() => setEditingPlan(false)} /> : null}
      {adding ? (
        <DayModal
          titleKey="training.newDayTitle"
          initial={{ name: "", dayType: "strength" }}
          onSubmit={addDay}
          onClose={() => setAdding(false)}
        />
      ) : null}
      {editingDay ? (
        <DayModal
          titleKey="training.editDay"
          initial={{ name: editingDay.name, dayType: editingDay.dayType }}
          onSubmit={(draft) => updateDay(editingDay.id, draft)}
          onClose={() => setEditingDay(null)}
        />
      ) : null}

      {/* Details card — tap ✎ to edit name, description and frequency. */}
      <section className="flex items-start gap-sm rounded-lg bg-card p-md">
        <div className="flex min-w-0 flex-1 flex-col gap-2xs">
          <p className="type-label text-app-amber">{freq ?? t("training.frequencyNone")}</p>
          <p className="whitespace-pre-line type-body text-muted">
            {plan.description || t("training.noDescription")}
          </p>
        </div>
        <button
          type="button"
          aria-label={t("training.editPlan")}
          onClick={() => setEditingPlan(true)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-hairline text-muted interactive motion-safe:active:scale-[0.97]"
        >
          <ComposeIcon width={16} height={16} />
        </button>
      </section>

      <div className="flex items-center justify-between gap-sm pt-xs">
        <h2 className="type-heading text-ink">{t("training.days")}</h2>
        <AddButton label={t("training.addDay")} onClick={() => setAdding(true)} />
      </div>

      <WriteErrorBanner code={writeError} />

      {isLoading ? (
        <ul className="flex flex-col gap-xs" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className={`h-16 w-full ${SKELETON}`} />
          ))}
        </ul>
      ) : isError ? (
        <EmptyCard titleKey="training.loadFailed" />
      ) : days.length === 0 ? (
        <EmptyCard titleKey="training.planEmptyTitle" hintKey="training.planEmptyHint" />
      ) : shown.length === 0 ? (
        <EmptyCard titleKey="training.noResults" />
      ) : (
        <ul className="flex flex-col gap-xs">
          {shown.map((day) => {
            const index = days.indexOf(day);
            const meta = dayMeta?.(day) ?? null;
            return (
              <li key={day.id} className="flex items-center gap-sm rounded-lg bg-card p-sm">
                <button
                  type="button"
                  onClick={() => onOpenDay(day.id)}
                  aria-label={`${t("training.openDay")}: ${day.name}`}
                  className="flex min-w-0 flex-1 flex-col items-start text-start interactive"
                >
                  <span className="w-full truncate type-heading text-ink">{day.name}</span>
                  <span className="flex min-w-0 items-center gap-xs">
                    <span className="shrink-0 rounded-pill bg-app-amber/15 px-xs py-2xs type-caption text-app-amber">
                      {t(DAY_TYPE_KEY[day.dayType])}
                    </span>
                    {meta ? <span className="truncate type-label text-muted">{meta}</span> : null}
                  </span>
                </button>
                <RowActions
                  onMoveUp={searching || index === 0 ? null : () => void move(index, -1)}
                  onMoveDown={
                    searching || index === days.length - 1 ? null : () => void move(index, 1)
                  }
                  onEdit={() => {
                    setConfirmId(null);
                    setEditingDay(day);
                  }}
                  confirming={confirmId === day.id}
                  onArmDelete={() => setConfirmId(day.id)}
                  onConfirmDelete={() => void deleteDay(day.id)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
