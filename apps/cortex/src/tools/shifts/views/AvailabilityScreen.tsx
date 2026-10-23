"use client";

/**
 * The manager's availability table (stage 2, part 5a) — BY SHIFT, the phone
 * view: for every shift of the week, in day order,
 *
 *   name · hours            can X / need Y   ✓ enough | ⚠ short
 *   ★ prefer      names
 *   · can         names
 *   ✗ can't       names
 *   ? not submitted  names
 *
 * "can" = submitted (has submitted_at) and did not mark ✗. "need" = the sum of
 * the shift's staffing requirements. Tapping a name opens a sheet with the
 * employee's answers to the three questions, their note and when they
 * submitted; not submitted → "unknown". A shift changed after an employee
 * submitted (template.updatedAt > submittedAt) gets a small marker by their
 * name, explained in the sheet.
 *
 * Reads: everyone's submissions and marks in one call (`shifts.week_overview`;
 * RLS lets an org admin read every private row), plus the shared caches for
 * templates, requirements, employees and org members. Read-only here — week
 * settings (deadline, reopen) come in part 6.
 */
import { useState } from "react";
import { useI18n } from "@/i18n";
import { CloseIcon, InfoIcon, StarIcon } from "@/components/icons";
import type { WeekChoice } from "../nav";
import type { AvailabilityMark, ShiftTemplate, Submission } from "../logic";
import { formatHours, isoDate, isOvernight, weekdayLong } from "../time";
import { effectiveDeadline } from "../deadline";
import { useClockFormat } from "../clockFormat";
import { totalRequired } from "../staffing";
import { memberName, visibleEmployees, type VisibleEmployee } from "../people";
import { shiftsOfDay, useShiftRequirements, useShiftTemplates } from "@/lib/query/useShiftTemplates";
import { useOrgMembers, useShiftEmployees } from "@/lib/query/useShiftsStaff";
import { useWeekOverview } from "@/lib/query/useShiftAvailability";
import { BottomSheet, EmptyCard, SKELETON, ToolHeader } from "./shared";
import { WeekSwitch, chosenWeekStart, useThisWeek } from "./WeekSwitch";

const WEEK = [0, 1, 2, 3, 4, 5, 6] as const;

type Row = "prefer" | "can" | "cannot" | "none";

interface Person {
  employee: VisibleEmployee;
  name: string;
  submission: Submission | null;
  /** Submitted = has a submitted_at. */
  submitted: boolean;
}

export function AvailabilityScreen({
  week,
  onWeekChange,
}: {
  week: WeekChoice;
  onWeekChange: (next: WeekChoice) => void;
}) {
  const { t, locale } = useI18n();
  const [clockFormat] = useClockFormat(locale);
  const thisWeek = useThisWeek();
  const weekStart = chosenWeekStart(thisWeek, week);
  const weekKey = weekStart === null ? null : isoDate(weekStart);

  const templatesQ = useShiftTemplates();
  const { requirements } = useShiftRequirements();
  const employeesQ = useShiftEmployees();
  const membersQ = useOrgMembers();
  const { overview, isLoading: overviewLoading, error: overviewError } = useWeekOverview(weekKey);
  const schemaMissing = overviewError instanceof Error && overviewError.message === "schemaMissing";

  const [openPerson, setOpenPerson] = useState<Person | null>(null);

  const loading =
    weekKey === null ||
    templatesQ.isLoading ||
    employeesQ.isLoading ||
    membersQ.isLoading ||
    overviewLoading;
  const failed = templatesQ.isError || employeesQ.isError || membersQ.isError || Boolean(overviewError);

  // Everyone in the tool (still in the org), joined to their submission.
  const people: Person[] = overview
    ? visibleEmployees(employeesQ.employees, membersQ.members, locale).map((employee) => {
        const submission = overview.submissions.find((s) => s.employeeId === employee.id) ?? null;
        return {
          employee,
          name: memberName(employee.member),
          submission,
          submitted: submission?.submittedAt != null,
        };
      })
    : [];
  const submittedCount = people.filter((p) => p.submitted).length;

  const markFor = (submissionId: string, templateId: string): AvailabilityMark["mark"] | null =>
    overview?.marks.find((m) => m.submissionId === submissionId && m.templateId === templateId)?.mark ??
    null;

  const rowOf = (p: Person, templateId: string): Row => {
    if (!p.submitted || !p.submission) return "none";
    const mark = markFor(p.submission.id, templateId);
    return mark === "cannot" ? "cannot" : mark === "prefer" ? "prefer" : "can";
  };

  /** The shift changed after this person submitted. */
  const changedAfter = (p: Person, tpl: ShiftTemplate) =>
    p.submission?.submittedAt != null && tpl.updatedAt > p.submission.submittedAt;

  const fmtTime = (d: Date) =>
    new Intl.DateTimeFormat(locale, {
      weekday: "long",
      day: "numeric",
      month: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);

  const deadline = weekKey !== null && overview ? effectiveDeadline(weekKey, overview.week) : null;
  const deadlinePassed = deadline !== null && deadline < new Date();

  return (
    <>
      <ToolHeader title={t("shifts.availabilityTitle")} subtitle={t("shifts.name")} />
      <WeekSwitch week={week} weekStart={weekStart} onChange={onWeekChange} />

      {schemaMissing ? (
        <EmptyCard titleKey="shifts.dbNotReadyTitle" hintKey="shifts.dbNotReadyHint" />
      ) : failed ? (
        <EmptyCard titleKey="shifts.loadFailed" />
      ) : loading || !overview || weekStart === null ? (
        <ul className="flex flex-col gap-xs" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className={`h-28 ${SKELETON}`} />
          ))}
        </ul>
      ) : (
        <>
          {/* Deadline + who submitted. */}
          <div className="flex items-center justify-between gap-sm rounded-lg bg-card px-md py-sm">
            <span className={`type-caption ${deadlinePassed ? "text-danger" : "text-muted"}`}>
              {deadline
                ? t(deadlinePassed ? "shifts.deadlineWas" : "shifts.deadlineUntil").replace(
                    "{time}",
                    fmtTime(deadline),
                  )
                : null}
            </span>
            <span className={`shrink-0 type-label ${people.length > 0 ? "text-ink" : "text-muted"}`}>
              {people.length > 0
                ? t("shifts.submittedCount")
                    .replace("{x}", String(submittedCount))
                    .replace("{y}", String(people.length))
                : t("shifts.noEmployeesInTool")}
            </span>
          </div>

          <ul className="flex flex-col gap-md">
            {WEEK.map((wd) => {
              const dayShifts = shiftsOfDay(templatesQ.templates, wd, locale);
              if (dayShifts.length === 0) return null;
              return (
                <li key={wd} className="flex flex-col gap-xs">
                  <span className="type-label text-ink">{weekdayLong(wd, locale)}</span>
                  {dayShifts.map((tpl) => {
                    const need = totalRequired(requirements, tpl.id);
                    const groups: Record<Row, Person[]> = { prefer: [], can: [], cannot: [], none: [] };
                    for (const p of people) groups[rowOf(p, tpl.id)].push(p);
                    const can = groups.prefer.length + groups.can.length;
                    const enough = need > 0 && can >= need;
                    return (
                      <div key={tpl.id} className="flex flex-col gap-xs rounded-lg bg-card p-md">
                        <div className="flex items-center justify-between gap-sm">
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate type-heading text-ink">{tpl.name}</span>
                            <span dir="ltr" className="flex items-baseline gap-2xs self-start type-caption text-muted">
                              {formatHours(tpl.startTime, tpl.endTime, clockFormat, locale)}
                              {isOvernight(tpl.startTime, tpl.endTime) ? (
                                <span className="text-app-coral" title={t("shifts.endsNextDay")}>
                                  {t("shifts.nextDayMark")}
                                </span>
                              ) : null}
                            </span>
                          </span>
                          {need > 0 ? (
                            <span
                              className={`shrink-0 rounded-pill px-sm py-2xs type-caption ${
                                enough ? "bg-app-coral/15 text-app-coral" : "bg-danger/10 text-danger"
                              }`}
                              title={t(enough ? "shifts.enoughPeople" : "shifts.notEnoughPeople")}
                            >
                              {enough ? "✓ " : "⚠ "}
                              {t("shifts.canVsNeed")
                                .replace("{can}", String(can))
                                .replace("{need}", String(need))}
                            </span>
                          ) : (
                            <span className="shrink-0 type-caption text-muted">{t("shifts.needNotSet")}</span>
                          )}
                        </div>

                        <dl className="flex flex-col gap-2xs">
                          {(["prefer", "can", "cannot", "none"] as Row[]).map((row) => (
                            <div key={row} className="flex items-start gap-xs">
                              <dt className="flex w-24 shrink-0 items-center gap-2xs type-caption text-muted">
                                <RowIcon row={row} />
                                {t(
                                  row === "prefer"
                                    ? "shifts.rowPrefer"
                                    : row === "can"
                                      ? "shifts.rowCan"
                                      : row === "cannot"
                                        ? "shifts.rowCannot"
                                        : "shifts.rowNotSubmitted",
                                )}
                              </dt>
                              <dd className="flex min-w-0 flex-1 flex-wrap gap-2xs">
                                {groups[row].length === 0 ? (
                                  <span className="type-caption text-muted">{t("shifts.noOne")}</span>
                                ) : (
                                  groups[row].map((p) => (
                                    <button
                                      key={p.employee.id}
                                      type="button"
                                      onClick={() => setOpenPerson(p)}
                                      className="flex items-center gap-2xs rounded-pill bg-screen px-sm py-2xs type-caption text-ink interactive motion-safe:active:scale-[0.97]"
                                    >
                                      {p.name}
                                      {changedAfter(p, tpl) ? (
                                        <span
                                          role="img"
                                          aria-label={t("shifts.shiftChangedAfterSubmit")}
                                          title={t("shifts.shiftChangedAfterSubmit")}
                                          className="flex text-app-coral"
                                        >
                                          <InfoIcon width={12} height={12} aria-hidden />
                                        </span>
                                      ) : null}
                                    </button>
                                  ))
                                )}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    );
                  })}
                </li>
              );
            })}
          </ul>

          {openPerson ? (
            <PersonSheet
              person={openPerson}
              templates={templatesQ.templates}
              fmtTime={fmtTime}
              onClose={() => setOpenPerson(null)}
            />
          ) : null}
        </>
      )}
    </>
  );
}

function RowIcon({ row }: { row: Row }) {
  if (row === "prefer") return <StarIcon width={12} height={12} className="text-app-coral" aria-hidden />;
  if (row === "cannot") return <CloseIcon width={12} height={12} className="text-danger" aria-hidden />;
  return (
    <span aria-hidden className="inline-block w-3 text-center">
      {row === "can" ? "·" : "?"}
    </span>
  );
}

/** One employee's answers, from the bottom. Not submitted → "unknown" everywhere. */
function PersonSheet({
  person,
  templates,
  fmtTime,
  onClose,
}: {
  person: Person;
  templates: readonly ShiftTemplate[];
  fmtTime: (d: Date) => string;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const s = person.submitted ? person.submission : null;
  const unknown = t("shifts.unknown");

  const shiftsAnswer =
    !s || (s.minShifts == null && s.maxShifts == null)
      ? unknown
      : s.minShifts != null && s.maxShifts != null
        ? t("shifts.shiftsRange").replace("{min}", String(s.minShifts)).replace("{max}", String(s.maxShifts))
        : s.minShifts != null
          ? t("shifts.shiftsMinOnly").replace("{min}", String(s.minShifts))
          : t("shifts.shiftsMaxOnly").replace("{max}", String(s.maxShifts));
  const doubleAnswer = !s || s.doubleShift == null
    ? unknown
    : t(s.doubleShift === "yes" ? "shifts.dblYes" : s.doubleShift === "no" ? "shifts.dblNo" : "shifts.dblIfNeeded");

  const changed = s?.submittedAt
    ? templates
        .filter((tpl) => tpl.updatedAt > (s.submittedAt as string))
        .map((tpl) => `${tpl.name} (${weekdayLong(tpl.weekday, locale)})`)
    : [];

  return (
    <BottomSheet title={person.name} onClose={onClose}>
      <p className={`type-label ${s?.submittedAt ? "text-ink" : "text-muted"}`}>
        {s?.submittedAt
          ? t("shifts.submittedAt").replace("{time}", fmtTime(new Date(s.submittedAt)))
          : t("shifts.notSubmitted")}
      </p>
      <dl className="flex flex-col gap-sm">
        <Answer label={t("shifts.qShiftsCount")} value={shiftsAnswer} muted={shiftsAnswer === unknown} />
        <Answer label={t("shifts.qDouble")} value={doubleAnswer} muted={doubleAnswer === unknown} />
        <Answer
          label={t("shifts.qNote")}
          value={!s ? unknown : s.note.trim() === "" ? t("shifts.noteNone") : s.note}
          muted={!s || s.note.trim() === ""}
        />
      </dl>
      {changed.length > 0 ? (
        <p className="flex items-start gap-xs rounded-md bg-app-coral/15 px-sm py-xs type-caption text-app-coral">
          <InfoIcon width={16} height={16} aria-hidden className="mt-2xs shrink-0" />
          <span>{t("shifts.changedShifts").replace("{list}", changed.join(", "))}</span>
        </p>
      ) : null}
    </BottomSheet>
  );
}

function Answer({ label, value, muted }: { label: string; value: string; muted: boolean }) {
  return (
    <div className="flex flex-col gap-2xs">
      <dt className="type-caption text-muted">{label}</dt>
      <dd className={`type-body ${muted ? "text-muted" : "text-ink"}`}>{value}</dd>
    </div>
  );
}
