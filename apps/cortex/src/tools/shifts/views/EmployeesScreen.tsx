"use client";

/**
 * Employees — the org members taking part in shifts.
 *
 *   "+ Add employee" → a picker of active org members NOT yet in the tool, each
 *                      with "Add", plus "Add everyone" (one server call).
 *   ✎ on a row      → opens it in place: a shift-lead switch, a checkbox per
 *                      position, and "Remove from the tool" behind a confirm.
 *                      Each change saves immediately (no separate Save).
 *
 * Someone who LEFT the org is hidden (`visibleEmployees`) — their row stays in
 * the DB. Managers only (page redirect; RLS needs `shifts.manage` to write).
 * Every write reconciles the shared caches; toggles are optimistic with revert.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { runIntentAction } from "@/cortex/actions";
import { CheckIcon, ComposeIcon } from "@/components/icons";
import type { AccessLevel, AddEmployeesResult, Employee, EmployeePosition } from "../logic";
import { memberName, membersNotInTool, visibleEmployees, type VisibleEmployee } from "../people";
import { sortPositions, useShiftPositions } from "@/lib/query/useShiftPositions";
import {
  SHIFT_EMPLOYEES_KEY,
  SHIFT_EMPLOYEE_POSITIONS_KEY,
  useOrgMembers,
  useShiftEmployeePositions,
  useShiftEmployees,
} from "@/lib/query/useShiftsStaff";
import {
  AddButton,
  EmptyCard,
  Modal,
  SKELETON,
  ToolHeader,
  WriteErrorBanner,
  useMounted,
  type WriteErrorCode,
} from "./shared";

export function EmployeesScreen() {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const membersQ = useOrgMembers();
  const employeesQ = useShiftEmployees();
  const linksQ = useShiftEmployeePositions();
  const positionsQ = useShiftPositions();
  const mounted = useMounted();

  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<WriteErrorCode | null>(null);
  // Rows with a write in flight — their controls are disabled meanwhile.
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());

  const loading =
    membersQ.isLoading || employeesQ.isLoading || linksQ.isLoading || positionsQ.isLoading;
  const failed = membersQ.isError || employeesQ.isError || linksQ.isError || positionsQ.isError;

  const visible = visibleEmployees(employeesQ.employees, membersQ.members, locale);
  const positions = sortPositions(positionsQ.positions, locale);

  /** Run one row's write with its controls locked; revert + report on failure. */
  async function rowWrite(
    rowId: string,
    optimistic: () => void,
    revert: () => void,
    write: () => ReturnType<typeof runIntentAction>,
    onOk?: (data: unknown) => void,
  ) {
    if (pending.has(rowId)) return;
    setPending((prev) => new Set(prev).add(rowId));
    setWriteError(null);
    optimistic();
    try {
      const res = await write();
      if (res.ok) onOk?.(res.data);
      else {
        revert();
        if (mounted.current) setWriteError(res.code);
      }
    } finally {
      if (mounted.current)
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(rowId);
          return next;
        });
    }
  }

  function setAccessLevel(e: VisibleEmployee, accessLevel: AccessLevel) {
    const patch = (level: AccessLevel) =>
      queryClient.setQueryData<Employee[]>(SHIFT_EMPLOYEES_KEY, (prev) =>
        (prev ?? []).map((it) => (it.id === e.id ? { ...it, accessLevel: level } : it)),
      );
    void rowWrite(
      e.id,
      () => patch(accessLevel),
      () => patch(e.accessLevel),
      () => runIntentAction("shifts.set_access_level", { id: e.id, accessLevel }),
    );
  }

  function togglePosition(e: VisibleEmployee, positionId: string) {
    const link = linksQ.links.find((l) => l.employeeId === e.id && l.positionId === positionId);
    if (link) {
      void rowWrite(
        e.id,
        () =>
          queryClient.setQueryData<EmployeePosition[]>(SHIFT_EMPLOYEE_POSITIONS_KEY, (prev) =>
            (prev ?? []).filter((l) => l.id !== link.id),
          ),
        () =>
          queryClient.setQueryData<EmployeePosition[]>(SHIFT_EMPLOYEE_POSITIONS_KEY, (prev) => [
            ...(prev ?? []),
            link,
          ]),
        () => runIntentAction("shifts.unassign_position", { id: link.id }),
      );
    } else {
      // Added for real only once the server returns the new id.
      void rowWrite(
        e.id,
        () => undefined,
        () => undefined,
        () => runIntentAction("shifts.assign_position", { employeeId: e.id, positionId }),
        (data) => {
          const { id } = data as { id: string };
          queryClient.setQueryData<EmployeePosition[]>(SHIFT_EMPLOYEE_POSITIONS_KEY, (prev) => [
            ...(prev ?? []),
            { id, employeeId: e.id, positionId },
          ]);
        },
      );
    }
  }

  function remove(e: VisibleEmployee) {
    const employeesSnapshot = queryClient.getQueryData<Employee[]>(SHIFT_EMPLOYEES_KEY);
    const linksSnapshot = queryClient.getQueryData<EmployeePosition[]>(SHIFT_EMPLOYEE_POSITIONS_KEY);
    void rowWrite(
      e.id,
      () => {
        // The DB cascades the position links — mirror that in the cache.
        queryClient.setQueryData<Employee[]>(SHIFT_EMPLOYEES_KEY, (prev) =>
          (prev ?? []).filter((it) => it.id !== e.id),
        );
        queryClient.setQueryData<EmployeePosition[]>(SHIFT_EMPLOYEE_POSITIONS_KEY, (prev) =>
          (prev ?? []).filter((l) => l.employeeId !== e.id),
        );
        setOpenId(null);
      },
      () => {
        queryClient.setQueryData<Employee[]>(SHIFT_EMPLOYEES_KEY, employeesSnapshot);
        queryClient.setQueryData<EmployeePosition[]>(SHIFT_EMPLOYEE_POSITIONS_KEY, linksSnapshot);
      },
      () => runIntentAction("shifts.remove_employee", { id: e.id }),
    );
  }

  return (
    <>
      <ToolHeader
        title={t("shifts.employeesTitle")}
        subtitle={t("shifts.name")}
        action={<AddButton label={t("shifts.addEmployee")} onClick={() => setAdding(true)} />}
      />
      <WriteErrorBanner code={writeError} />

      {adding ? <AddEmployeesModal onClose={() => setAdding(false)} /> : null}

      {loading ? (
        <ul className="flex flex-col divide-y divide-hairline" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex flex-col gap-2xs py-sm">
              <span className={`h-5 w-32 ${SKELETON}`} />
              <span className={`h-4 w-24 ${SKELETON}`} />
            </li>
          ))}
        </ul>
      ) : failed ? (
        <EmptyCard titleKey="shifts.loadFailed" />
      ) : visible.length === 0 ? (
        <EmptyCard
          titleKey="shifts.emptyEmployeesTitle"
          hintKey="shifts.emptyEmployeesHint"
          action={<AddButton label={t("shifts.addEmployee")} onClick={() => setAdding(true)} />}
        />
      ) : (
        <ul className="flex flex-col divide-y divide-hairline">
          {visible.map((e) => {
            const held = linksQ.links
              .filter((l) => l.employeeId === e.id)
              .map((l) => l.positionId);
            const heldNames = positions.filter((p) => held.includes(p.id)).map((p) => p.name);
            const busy = pending.has(e.id);
            return (
              <li key={e.id} className="flex flex-col gap-xs py-sm">
                <div className="flex items-center gap-sm">
                  <div className="flex min-w-0 flex-1 flex-col gap-2xs">
                    <div className="flex items-center gap-xs">
                      <span className="min-w-0 truncate type-heading text-ink">
                        {memberName(e.member)}
                      </span>
                      {e.accessLevel === "shift_lead" ? (
                        <span className="shrink-0 rounded-pill bg-app-coral/15 px-xs py-2xs type-caption text-app-coral">
                          {t("shifts.shiftLead")}
                        </span>
                      ) : null}
                    </div>
                    <span className="truncate type-label text-muted">
                      {heldNames.length > 0 ? heldNames.join(" · ") : t("shifts.noPositions")}
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-label={t("shifts.edit")}
                    aria-expanded={openId === e.id}
                    onClick={() => setOpenId((cur) => (cur === e.id ? null : e.id))}
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full interactive motion-safe:active:scale-[0.97] ${
                      openId === e.id ? "bg-app-coral/15 text-app-coral" : "bg-hairline text-muted"
                    }`}
                  >
                    <ComposeIcon width={16} height={16} />
                  </button>
                </div>

                {openId === e.id ? (
                  <EmployeeEditor
                    employee={e}
                    positions={positions}
                    held={held}
                    busy={busy}
                    onToggleLead={(isLead) => setAccessLevel(e, isLead ? "shift_lead" : "employee")}
                    onTogglePosition={(positionId) => togglePosition(e, positionId)}
                    onRemove={() => remove(e)}
                    onClose={() => setOpenId(null)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** The in-place editor under an employee row. Every change saves immediately. */
function EmployeeEditor({
  employee,
  positions,
  held,
  busy,
  onToggleLead,
  onTogglePosition,
  onRemove,
  onClose,
}: {
  employee: VisibleEmployee;
  positions: Array<{ id: string; name: string }>;
  held: string[];
  busy: boolean;
  onToggleLead: (isLead: boolean) => void;
  onTogglePosition: (positionId: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const isLead = employee.accessLevel === "shift_lead";

  return (
    <div className="flex flex-col gap-sm rounded-lg bg-card p-md">
      {/* Shift-lead switch. */}
      <button
        type="button"
        role="switch"
        aria-checked={isLead}
        disabled={busy}
        onClick={() => onToggleLead(!isLead)}
        className="flex items-center justify-between gap-sm text-start interactive"
      >
        <span className="type-body text-ink">{t("shifts.shiftLeadToggle")}</span>
        <span
          aria-hidden="true"
          className={`flex h-6 w-11 shrink-0 items-center rounded-pill p-2xs transition-colors ${
            isLead ? "justify-end bg-app-coral" : "justify-start bg-hairline"
          }`}
        >
          <span className="h-5 w-5 rounded-full bg-card shadow-lifted" />
        </span>
      </button>

      {/* Positions — a checkbox per position. */}
      <div className="flex flex-col gap-2xs">
        <span className="type-label text-muted">{t("shifts.positionsLabel")}</span>
        {positions.length === 0 ? (
          <span className="type-caption text-muted">{t("shifts.noPositionsDefined")}</span>
        ) : (
          <div className="flex flex-wrap gap-xs">
            {positions.map((p) => {
              const checked = held.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  disabled={busy}
                  onClick={() => onTogglePosition(p.id)}
                  className={`flex items-center gap-2xs rounded-pill px-sm py-xs type-label interactive motion-safe:active:scale-[0.97] ${
                    checked ? "bg-app-coral text-on-fill" : "bg-hairline text-ink"
                  }`}
                >
                  {checked ? <CheckIcon width={14} height={14} aria-hidden /> : null}
                  {p.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Remove from the tool — behind a confirm. */}
      {confirmingRemove ? (
        <div role="alert" className="flex flex-col gap-xs rounded-md bg-danger/10 px-sm py-xs">
          <p className="type-label text-danger">
            {t("shifts.confirmRemove").replace("{name}", memberName(employee.member))}
          </p>
          <div className="flex gap-xs">
            <button
              type="button"
              disabled={busy}
              onClick={onRemove}
              className="rounded-pill bg-danger px-sm py-2xs type-caption text-on-fill interactive motion-safe:active:scale-[0.97]"
            >
              {t("shifts.confirmRemoveYes")}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingRemove(false)}
              className="rounded-pill bg-hairline px-sm py-2xs type-caption text-ink interactive motion-safe:active:scale-[0.97]"
            >
              {t("shifts.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-sm">
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmingRemove(true)}
            className="type-label text-danger underline interactive"
          >
            {t("shifts.removeFromTool")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-pill bg-hairline px-md py-xs type-label text-ink interactive motion-safe:active:scale-[0.97]"
          >
            {t("shifts.close")}
          </button>
        </div>
      )}
    </div>
  );
}

/** "+ Add employee": active org members not in the tool yet, one by one or all. */
function AddEmployeesModal({ onClose }: { onClose: () => void }) {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const mounted = useMounted();
  const { members } = useOrgMembers();
  const { employees } = useShiftEmployees();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<WriteErrorCode | null>(null);
  const [failedCount, setFailedCount] = useState(0);

  const candidates = membersNotInTool(members, employees, locale);

  async function add(userIds: string[]) {
    if (submitting || userIds.length === 0) return;
    setSubmitting(true);
    setError(null);
    setFailedCount(0);
    try {
      const res = await runIntentAction("shifts.add_employees", { userIds });
      if (!res.ok) {
        if (mounted.current) setError(res.code);
        return;
      }
      const { created, failed } = res.data as AddEmployeesResult;
      queryClient.setQueryData<Employee[]>(SHIFT_EMPLOYEES_KEY, (prev) => [
        ...(prev ?? []),
        ...created,
      ]);
      if (mounted.current) setFailedCount(failed.length);
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  return (
    <Modal title={t("shifts.addEmployeesTitle")} onClose={onClose} onSubmit={(e) => e.preventDefault()}>
      <WriteErrorBanner code={error} />
      {failedCount > 0 ? (
        <p role="alert" className="type-caption text-danger">
          {t("shifts.addFailedSome").replace("{count}", String(failedCount))}
        </p>
      ) : null}
      {candidates.length === 0 ? (
        <p className="type-label text-muted">{t("shifts.allMembersInTool")}</p>
      ) : (
        <>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void add(candidates.map((m) => m.userId))}
            className="rounded-md bg-app-coral/15 py-sm type-label text-app-coral interactive motion-safe:active:scale-[0.97]"
          >
            {t("shifts.addAll")} ({candidates.length})
          </button>
          <ul className="flex flex-col divide-y divide-hairline">
            {candidates.map((m) => (
              <li key={m.userId} className="flex items-center gap-sm py-xs">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate type-body text-ink">{memberName(m)}</span>
                  <span dir="ltr" className="truncate text-start type-caption text-muted">
                    {m.email}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void add([m.userId])}
                  className="shrink-0 rounded-pill bg-app-coral px-sm py-2xs type-caption text-on-fill interactive motion-safe:active:scale-[0.97]"
                >
                  {t("shifts.addThis")}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <button
        type="button"
        onClick={onClose}
        className="rounded-md bg-hairline py-sm type-label text-ink interactive motion-safe:active:scale-[0.97]"
      >
        {t("shifts.close")}
      </button>
    </Modal>
  );
}
