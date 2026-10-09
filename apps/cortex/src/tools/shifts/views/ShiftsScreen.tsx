"use client";

/**
 * Shifts — the opening section. A day strip (Sunday → Saturday; today selected
 * by default) and the selected day's shifts, each with its hours ("+1" when it
 * crosses midnight). Tapping a shift opens its edit screen. "+ Add shift" opens
 * a modal for the selected day.
 *
 * "Copy <day> to all days" REPLACES every other day's shifts with this day's —
 * names, hours and requirements — behind a confirmation that says how many
 * existing shifts will be deleted. Disabled on a day with no shifts (copying an
 * empty day would only wipe the week).
 *
 * The selected day lives in the URL (?day=) via replaceState, so a refresh keeps
 * it and the back button doesn't walk through days.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { runIntentAction } from "@/cortex/actions";
import type { ShiftTemplate } from "../logic";
import { formatHours, isOvernight, todayWeekday, weekdayLong, weekdayNarrow } from "../time";
import { useClockFormat } from "../clockFormat";
import {
  SHIFT_REQUIREMENTS_KEY,
  SHIFT_TEMPLATES_KEY,
  shiftsOfDay,
  useShiftTemplates,
} from "@/lib/query/useShiftTemplates";
import { ShiftFields } from "./ShiftForm";
import {
  AddButton,
  Dialog,
  EmptyCard,
  SKELETON,
  ToolHeader,
  WriteErrorBanner,
  useMounted,
  type WriteErrorCode,
} from "./shared";

const WEEK = [0, 1, 2, 3, 4, 5, 6] as const;

export function ShiftsScreen({
  day,
  onDayChange,
  onOpenShift,
}: {
  /** The selected weekday from the URL, or null = today. */
  day: number | null;
  onDayChange: (weekday: number) => void;
  onOpenShift: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const mounted = useMounted();
  // 24-hour vs AM/PM — the same per-device choice the time picker sets.
  const [clockFormat] = useClockFormat(locale);
  const { templates, isLoading, isError } = useShiftTemplates();
  const today = todayWeekday();
  const selected = day ?? today;
  const dayShifts = shiftsOfDay(templates, selected, locale);
  const dayName = weekdayLong(selected, locale);

  const [adding, setAdding] = useState(false);
  const [confirmingCopy, setConfirmingCopy] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState<WriteErrorCode | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const othersCount = templates.filter((tpl) => tpl.weekday !== selected).length;

  async function copyToAll() {
    if (copying) return;
    setCopying(true);
    setCopyError(null);
    try {
      const res = await runIntentAction("shifts.copy_day_to_all", { weekday: selected });
      // Success OR failure part-way: re-read, since many rows may have changed.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SHIFT_TEMPLATES_KEY }),
        queryClient.invalidateQueries({ queryKey: SHIFT_REQUIREMENTS_KEY }),
      ]);
      if (!mounted.current) return;
      if (res.ok) {
        setConfirmingCopy(false);
        setNotice(t("shifts.copyDone").replace("{day}", dayName));
      } else {
        setCopyError(res.code);
      }
    } finally {
      if (mounted.current) setCopying(false);
    }
  }

  return (
    <>
      <ToolHeader
        title={t("shifts.name")}
        action={<AddButton label={t("shifts.addShift")} onClick={() => setAdding(true)} />}
      />

      {/* Day strip — Sunday first; grid columns follow the page direction. */}
      <div role="tablist" aria-label={t("shifts.daysLabel")} className="grid grid-cols-7 gap-2xs">
        {WEEK.map((wd) => {
          const active = wd === selected;
          return (
            <button
              key={wd}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={weekdayLong(wd, locale)}
              onClick={() => {
                setNotice(null);
                onDayChange(wd);
              }}
              className={`flex h-10 items-center justify-center rounded-pill type-label interactive motion-safe:active:scale-[0.97] ${
                active
                  ? "bg-app-coral text-on-fill"
                  : wd === today
                    ? "bg-app-coral/15 text-app-coral"
                    : "bg-card text-ink"
              }`}
            >
              {weekdayNarrow(wd, locale)}
            </button>
          );
        })}
      </div>

      <span className="type-label text-muted">{dayName}</span>

      {notice ? (
        <p role="status" className="rounded-md bg-app-coral/15 px-sm py-xs type-label text-app-coral">
          {notice}
        </p>
      ) : null}

      {adding ? (
        <Dialog title={`${t("shifts.addShift")} · ${dayName}`} onClose={() => setAdding(false)}>
          <ShiftFields
            initial={{ name: "", startTime: "", endTime: "" }}
            dayShifts={dayShifts}
            submitLabel={t("shifts.add")}
            onSubmit={async (draft) => {
              const res = await runIntentAction("shifts.create_template", {
                weekday: selected,
                ...draft,
              });
              if (!res.ok) return res.code;
              const { id } = res.data as { id: string };
              queryClient.setQueryData<ShiftTemplate[]>(SHIFT_TEMPLATES_KEY, (prev) => [
                ...(prev ?? []),
                { id, weekday: selected, ...draft },
              ]);
              setAdding(false);
              return null;
            }}
            onCancel={() => setAdding(false)}
          />
        </Dialog>
      ) : null}

      {confirmingCopy ? (
        <Dialog title={t("shifts.copyTitle")} onClose={() => !copying && setConfirmingCopy(false)}>
          <WriteErrorBanner code={copyError} />
          <p className="type-body text-ink">
            {(othersCount > 0 ? t("shifts.copyConfirm") : t("shifts.copyConfirmNone"))
              .replace("{day}", dayName)
              .replace("{count}", String(othersCount))}
          </p>
          <div className="flex gap-sm pt-xs">
            <button
              type="button"
              disabled={copying}
              onClick={() => void copyToAll()}
              className="flex-1 rounded-md bg-danger py-sm type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
            >
              {t("shifts.copyYes")}
            </button>
            <button
              type="button"
              disabled={copying}
              onClick={() => setConfirmingCopy(false)}
              className="flex-1 rounded-md bg-hairline py-sm type-label text-ink interactive motion-safe:active:scale-[0.97]"
            >
              {t("shifts.cancel")}
            </button>
          </div>
        </Dialog>
      ) : null}

      {isLoading ? (
        <ul className="flex flex-col gap-xs" aria-hidden="true">
          {[0, 1].map((i) => (
            <li key={i} className={`h-16 ${SKELETON}`} />
          ))}
        </ul>
      ) : isError ? (
        <EmptyCard titleKey="shifts.loadFailed" />
      ) : dayShifts.length === 0 ? (
        <EmptyCard
          titleKey="shifts.noShiftsTitle"
          hintKey="shifts.noShiftsHint"
          action={<AddButton label={t("shifts.addShift")} onClick={() => setAdding(true)} />}
        />
      ) : (
        <ul className="flex flex-col gap-xs">
          {dayShifts.map((s) => {
            const overnight = isOvernight(s.startTime, s.endTime);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onOpenShift(s.id)}
                  aria-label={`${t("shifts.editShift")}: ${s.name}`}
                  className="flex w-full items-center justify-between gap-sm rounded-lg bg-card p-md text-start interactive motion-safe:active:scale-[0.99]"
                >
                  <span className="min-w-0 truncate type-heading text-ink">{s.name}</span>
                  <span dir="ltr" className="flex shrink-0 items-baseline gap-2xs type-label text-muted">
                    {formatHours(s.startTime, s.endTime, clockFormat, locale)}
                    {overnight ? (
                      <span
                        className="type-caption text-app-coral"
                        title={t("shifts.endsNextDay")}
                      >
                        {t("shifts.nextDayMark")}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Copy this day to every other day — disabled when there is nothing to copy. */}
      {!isLoading && !isError ? (
        <div className="flex flex-col items-center gap-2xs">
          <button
            type="button"
            disabled={dayShifts.length === 0}
            onClick={() => {
              setCopyError(null);
              setConfirmingCopy(true);
            }}
            className={`rounded-pill bg-hairline px-md py-xs type-label text-ink interactive motion-safe:active:scale-[0.97] ${
              dayShifts.length === 0 ? "opacity-[var(--ds-disabled-opacity)]" : ""
            }`}
          >
            {t("shifts.copyToAll").replace("{day}", dayName)}
          </button>
          {dayShifts.length === 0 ? (
            <span className="type-caption text-muted">{t("shifts.copyEmptyHint")}</span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
