"use client";

/**
 * The day screen: a summary on top (how many exercises, how many sets in
 * total), then the day's exercises. Each row shows the name, "sets × reps",
 * target weight, rest and notes; ↑/↓ reorder, ✎ edits, ✕ is a two-tap delete.
 * "Add exercise" sits next to the summary.
 *
 * Every write reconciles the shared exercises cache with `setQueryData`.
 * Reordering is optimistic and is put back if the write fails.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { runIntentAction } from "@/cortex/actions";
import { TRAINING_EXERCISES_KEY, useTrainingExercises } from "@/lib/query/useTrainingExercises";
import type { Day, Exercise, ExerciseFields } from "../logic";
import { DAY_TYPE_KEY } from "./DayModal";
import { ExerciseModal } from "./ExerciseModal";
import {
  AddButton,
  EmptyCard,
  RowActions,
  SKELETON,
  WriteErrorBanner,
  matchesSearch,
  moved,
  type WriteErrorCode,
} from "./shared";

/** "N exercises · M sets" — shared with the plan screen's per-day line. */
export function useExerciseSummary() {
  const { t } = useI18n();
  return (list: Exercise[]): string => {
    const sets = list.reduce((sum, e) => sum + (e.sets ?? 0), 0);
    const exercisesText =
      list.length === 1
        ? t("training.exercisesOne")
        : t("training.exercisesMany").replace("{count}", String(list.length));
    const setsText =
      sets === 1 ? t("training.setsOne") : t("training.setsMany").replace("{count}", String(sets));
    return `${exercisesText} · ${setsText}`;
  };
}

/** The row's detail line: "3 × 8-12 · 60 kg · rest 90 s". */
function useExerciseDetails() {
  const { t } = useI18n();
  return (e: Exercise): string => {
    const parts: string[] = [];
    if (e.sets != null && e.reps) {
      parts.push(
        t("training.setsTimesReps").replace("{sets}", String(e.sets)).replace("{reps}", e.reps),
      );
    } else if (e.sets != null) {
      parts.push(
        e.sets === 1 ? t("training.setsOne") : t("training.setsMany").replace("{count}", String(e.sets)),
      );
    } else if (e.reps) {
      parts.push(t("training.repsOnly").replace("{reps}", e.reps));
    }
    if (e.targetWeight != null) {
      parts.push(t("training.weightKg").replace("{weight}", String(e.targetWeight)));
    }
    if (e.restSeconds != null) {
      parts.push(t("training.restSeconds").replace("{seconds}", String(e.restSeconds)));
    }
    return parts.join(" · ");
  };
}

export function DayScreen({ day, search }: { day: Day; search: string }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const summary = useExerciseSummary();
  const details = useExerciseDetails();
  const { exercises: all, isLoading, isError } = useTrainingExercises();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Exercise | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<WriteErrorCode | null>(null);

  const exercises = all.filter((e) => e.dayId === day.id);

  const setAll = (fn: (prev: Exercise[]) => Exercise[]) =>
    queryClient.setQueryData<Exercise[]>(TRAINING_EXERCISES_KEY, (prev) => fn(prev ?? []));

  async function addExercise(fields: ExerciseFields): Promise<WriteErrorCode | null> {
    const res = await runIntentAction("training.add_exercise", { dayId: day.id, ...fields });
    if (!res.ok) return res.code;
    const created = res.data as Exercise;
    setAll((prev) => [...prev, created]);
    return null;
  }

  async function updateExercise(id: string, fields: ExerciseFields): Promise<WriteErrorCode | null> {
    const res = await runIntentAction("training.update_exercise", { id, ...fields });
    if (!res.ok) return res.code;
    setAll((prev) => prev.map((e) => (e.id === id ? { ...e, ...fields } : e)));
    return null;
  }

  async function deleteExercise(id: string) {
    setConfirmId(null);
    setWriteError(null);
    const res = await runIntentAction("training.delete_exercise", { id });
    if (!res.ok) {
      setWriteError(res.code);
      return;
    }
    setAll((prev) => prev.filter((e) => e.id !== id));
  }

  async function move(index: number, step: -1 | 1) {
    const next = moved(exercises, index, step);
    if (!next) return;
    setWriteError(null);
    const order = new Map(next.map((e, i) => [e.id, i]));
    // Other days' rows keep their place; this day's rows take the new order.
    setAll((prev) => {
      const others = prev.filter((e) => e.dayId !== day.id);
      const mine = next.map((e) => ({ ...e, sortOrder: order.get(e.id) ?? e.sortOrder }));
      return [...others, ...mine];
    });
    const res = await runIntentAction("training.reorder_exercises", { ids: next.map((e) => e.id) });
    if (!res.ok) {
      // Several row writes; some may have landed — re-read the real order.
      void queryClient.invalidateQueries({ queryKey: TRAINING_EXERCISES_KEY });
      setWriteError(res.code);
    }
  }

  const searching = search.trim() !== "";
  const shown = exercises.filter((e) => matchesSearch(e.name, search) || matchesSearch(e.notes, search));

  return (
    <>
      {adding ? (
        <ExerciseModal
          titleKey="training.newExerciseTitle"
          initial={null}
          onSubmit={addExercise}
          onClose={() => setAdding(false)}
        />
      ) : null}
      {editing ? (
        <ExerciseModal
          titleKey="training.editExercise"
          initial={editing}
          onSubmit={(fields) => updateExercise(editing.id, fields)}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {/* Summary — the day's type, how many exercises and sets in total. */}
      <section className="flex items-center justify-between gap-sm rounded-lg bg-card p-md">
        <div className="flex min-w-0 flex-col gap-2xs">
          <span className="w-fit rounded-pill bg-app-amber/15 px-xs py-2xs type-caption text-app-amber">
            {t(DAY_TYPE_KEY[day.dayType])}
          </span>
          {isLoading ? (
            <span className={`block h-4 w-32 ${SKELETON}`} aria-hidden="true" />
          ) : (
            <p className="truncate type-heading text-ink">{summary(exercises)}</p>
          )}
        </div>
        <AddButton label={t("training.addExercise")} onClick={() => setAdding(true)} />
      </section>

      <WriteErrorBanner code={writeError} />

      {isLoading ? (
        <ul className="flex flex-col gap-xs" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className={`h-16 w-full ${SKELETON}`} />
          ))}
        </ul>
      ) : isError ? (
        <EmptyCard titleKey="training.loadFailed" />
      ) : exercises.length === 0 ? (
        <EmptyCard titleKey="training.dayEmptyTitle" hintKey="training.dayEmptyHint" />
      ) : shown.length === 0 ? (
        <EmptyCard titleKey="training.noResults" />
      ) : (
        <ul className="flex flex-col gap-xs">
          {shown.map((exercise) => {
            const index = exercises.indexOf(exercise);
            const line = details(exercise);
            return (
              <li key={exercise.id} className="flex items-center gap-sm rounded-lg bg-card p-sm">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate type-heading text-ink">{exercise.name}</span>
                  {line ? <span className="truncate type-label text-app-amber">{line}</span> : null}
                  {exercise.notes ? (
                    <span className="line-clamp-2 type-label text-muted">{exercise.notes}</span>
                  ) : null}
                </div>
                <RowActions
                  onMoveUp={searching || index === 0 ? null : () => void move(index, -1)}
                  onMoveDown={
                    searching || index === exercises.length - 1 ? null : () => void move(index, 1)
                  }
                  onEdit={() => {
                    setConfirmId(null);
                    setEditing(exercise);
                  }}
                  confirming={confirmId === exercise.id}
                  onArmDelete={() => setConfirmId(exercise.id)}
                  onConfirmDelete={() => void deleteExercise(exercise.id)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
