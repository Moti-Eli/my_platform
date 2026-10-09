"use client";

/**
 * Our own time picker (replaces the browser's <input type="time">), for the
 * shift form. Opens INLINE under the field (no second overlay on top of the add
 * dialog), finger-sized rows:
 *
 *   [ 24h | AM/PM ]           ← per-device switch (clockFormat.ts)
 *   hours   │ minutes │ (AM/PM)
 *
 * NO LOOPING: each column is a plain list with a real start and end — 23 (or
 * 11) does not wrap to 0, 45 does not wrap to 00. Minutes come in quarters
 * (00, 15, 30, 45); an existing value off the quarter (e.g. 07:10 saved before)
 * is kept and shown as an extra option rather than silently changed.
 *
 * The value is always stored as "HH:MM" (24-hour) — the 12-hour mode is display
 * only. Picking an hour with no minute yet fills in ":00".
 */
import { useEffect, useRef } from "react";
import { useI18n } from "@/i18n";
import { useClockFormat } from "../clockFormat";
import { dayPeriodLabels, formatTime } from "../time";
import { inputClass, invalidRing } from "./shared";

const QUARTERS = [0, 15, 30, 45];
const pad = (n: number) => String(n).padStart(2, "0");

function split(value: string): { h: number | null; m: number | null } {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return match ? { h: Number(match[1]), m: Number(match[2]) } : { h: null, m: null };
}

/** The field itself: shows the chosen time (or a prompt) and opens the panel. */
export function TimeTrigger({
  label,
  value,
  open,
  invalid,
  onToggle,
}: {
  label: string;
  value: string;
  open: boolean;
  invalid: boolean;
  onToggle: () => void;
}) {
  const { t, locale } = useI18n();
  const [format] = useClockFormat(locale);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2xs type-label text-muted">
      <span>
        {label}{" "}
        <span aria-hidden="true" className="text-danger">
          *
        </span>
      </span>
      <button
        type="button"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        onClick={onToggle}
        className={`${inputClass} text-start ${invalid ? invalidRing : ""} ${
          open ? "ring-1 ring-app-coral" : ""
        } ${value ? "" : "text-muted"}`}
      >
        <span dir="ltr">{value ? formatTime(value, format, locale) : t("shifts.chooseTime")}</span>
      </button>
    </div>
  );
}

/** The inline panel: format switch + hour / minute (/ AM-PM) columns + Done. */
export function TimePanel({
  value,
  onChange,
  onDone,
}: {
  value: string;
  onChange: (next: string) => void;
  onDone: () => void;
}) {
  const { t, locale } = useI18n();
  const [format, setFormat] = useClockFormat(locale);
  const { h, m } = split(value);
  const [am, pm] = dayPeriodLabels(locale);

  const minutes = m !== null && !QUARTERS.includes(m) ? [...QUARTERS, m].sort((a, b) => a - b) : QUARTERS;

  /** Commit an hour (0–23) and minute; a missing minute becomes :00. */
  const commit = (hour: number, minute: number | null) =>
    onChange(`${pad(hour)}:${pad(minute ?? 0)}`);

  // 12-hour view of the stored hour: 12, 1 … 11 and the period.
  const isPm = h !== null && h >= 12;
  const hour12 = h === null ? null : h % 12 === 0 ? 12 : h % 12;
  const hourOptions =
    format === "24"
      ? Array.from({ length: 24 }, (_, i) => ({ key: i, label: pad(i), selected: h === i }))
      : [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => ({
          key: n,
          label: String(n),
          selected: hour12 === n,
        }));

  const pickHour = (key: number) => {
    if (format === "24") commit(key, m);
    else commit((key % 12) + (isPm ? 12 : 0), m);
  };
  const pickPeriod = (toPm: boolean) => {
    const base = h ?? 0;
    const next = toPm ? (base % 12) + 12 : base % 12;
    commit(next, m);
  };

  return (
    <div className="flex flex-col gap-sm rounded-lg bg-screen p-sm">
      {/* Format switch — saved on this device. */}
      <div className="flex items-center justify-between gap-sm">
        <span className="type-caption text-muted">{t("shifts.clockFormatLabel")}</span>
        <div className="flex rounded-pill bg-hairline p-2xs" role="radiogroup">
          {(["24", "12"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={format === f}
              onClick={() => setFormat(f)}
              className={`rounded-pill px-sm py-2xs type-caption interactive ${
                format === f ? "bg-app-coral text-on-fill" : "text-ink"
              }`}
            >
              {t(f === "24" ? "shifts.clock24" : "shifts.clock12")}
            </button>
          ))}
        </div>
      </div>

      {/* Columns — LTR so hours sit left of minutes, like a clock. */}
      <div dir="ltr" className="flex gap-xs">
        <Column
          label={t("shifts.hoursLabel")}
          options={hourOptions}
          onPick={pickHour}
        />
        <Column
          label={t("shifts.minutesLabel")}
          options={minutes.map((n) => ({ key: n, label: pad(n), selected: m === n }))}
          onPick={(minute) => commit(h ?? 0, minute)}
        />
        {format === "12" ? (
          <Column
            label={t("shifts.periodLabel")}
            options={[
              { key: 0, label: am, selected: h !== null && !isPm },
              { key: 1, label: pm, selected: isPm },
            ]}
            onPick={(k) => pickPeriod(k === 1)}
          />
        ) : null}
      </div>

      <button
        type="button"
        onClick={onDone}
        className="rounded-md bg-app-coral py-sm type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
      >
        {t("shifts.done")}
      </button>
    </div>
  );
}

/** One scrollable, non-looping column. The selected row scrolls into view on open. */
function Column({
  label,
  options,
  onPick,
}: {
  label: string;
  options: Array<{ key: number; label: string; selected: boolean }>;
  onPick: (key: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Center the selected row by scrolling THIS list only (scrollIntoView could
    // also scroll the dialog / page). Only on mount — later picks must not yank
    // the list around.
    const list = listRef.current;
    const row = selectedRef.current;
    if (list && row) {
      list.scrollTop = row.offsetTop - list.clientHeight / 2 + row.clientHeight / 2;
    }
  }, []);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2xs">
      <span className="text-center type-caption text-muted">{label}</span>
      <div
        ref={listRef}
        role="listbox"
        aria-label={label}
        className="relative flex max-h-48 snap-y flex-col gap-2xs overflow-y-auto overscroll-contain rounded-md bg-card p-2xs"
      >
        {options.map((o) => (
          <button
            key={o.key}
            ref={o.selected ? selectedRef : undefined}
            type="button"
            role="option"
            aria-selected={o.selected}
            onClick={() => onPick(o.key)}
            className={`flex min-h-11 shrink-0 snap-center items-center justify-center rounded-md type-body interactive ${
              o.selected ? "bg-app-coral text-on-fill" : "text-ink"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
