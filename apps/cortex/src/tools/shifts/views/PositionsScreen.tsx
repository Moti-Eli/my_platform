"use client";

/**
 * Positions — the restaurant's job positions (waiter, cook, bartender…).
 * Add (modal), rename (inline), reorder (↑ / ↓ — easier than dragging on a
 * phone), delete (two-tap). Managers only (the page redirects others; RLS
 * requires `shifts.manage` for every write).
 *
 * Reads the shared cache (`useShiftPositions`); every write reconciles it —
 * rename / reorder / delete optimistically with a revert on a real failure.
 * Names are checked for duplicates client-side (the DB also refuses them), so
 * a duplicate gets a clear message instead of the generic failure.
 */
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { runIntentAction } from "@/cortex/actions";
import { ChevronDownIcon } from "@/components/icons";
import type { Position } from "../logic";
import { POSITION_NAME_MAX } from "../intents";
import {
  SHIFT_POSITIONS_KEY,
  sortPositions,
  useShiftPositions,
} from "@/lib/query/useShiftPositions";
import {
  SHIFT_EMPLOYEE_POSITIONS_KEY,
  useOrgMembers,
  useShiftEmployeePositions,
  useShiftEmployees,
} from "@/lib/query/useShiftsStaff";
import type { EmployeePosition } from "../logic";
import { employeeCountByPosition, visibleEmployees } from "../people";
import { shiftsRequiringPosition } from "../staffing";
import { useShiftRequirements } from "@/lib/query/useShiftTemplates";
import {
  AddButton,
  useCountLabel,
  EmptyCard,
  FormActions,
  Modal,
  RowActions,
  SKELETON,
  TextField,
  ToolHeader,
  WriteErrorBanner,
  useMounted,
  type WriteErrorCode,
} from "./shared";

/** Case/space-insensitive name match ("  Waiter " = "waiter"). */
function sameName(a: string, b: string, locale: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  return norm(a).localeCompare(norm(b), locale, { sensitivity: "base" }) === 0;
}

const arrowButton =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-hairline text-muted interactive motion-safe:active:scale-[0.97]";

export function PositionsScreen() {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const { positions: raw, isLoading, isError } = useShiftPositions();
  const positions = sortPositions(raw, locale);
  const mounted = useMounted();
  const count = useCountLabel();
  // Employee counts per position — VISIBLE employees only (left the org = hidden).
  const { members } = useOrgMembers();
  const { employees } = useShiftEmployees();
  const { links } = useShiftEmployeePositions();
  const counts = employeeCountByPosition(links, visibleEmployees(employees, members, locale));
  // Shifts that still require each position — such a position can't be deleted.
  const { requirements } = useShiftRequirements();
  const requiredBy = shiftsRequiringPosition(requirements);
  // Which position's "can't delete" explanation is showing.
  const [blockedId, setBlockedId] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<WriteErrorCode | null>(null);
  // One write at a time per screen — reorders touch every row.
  const [busy, setBusy] = useState(false);

  /** Optimistic cache write; reverts and reports if `write` fails. */
  async function optimistic(
    apply: (prev: Position[]) => Position[],
    write: () => ReturnType<typeof runIntentAction>,
  ) {
    if (busy) return;
    setBusy(true);
    setWriteError(null);
    const snapshot = queryClient.getQueryData<Position[]>(SHIFT_POSITIONS_KEY);
    queryClient.setQueryData<Position[]>(SHIFT_POSITIONS_KEY, (prev) => apply(prev ?? []));
    try {
      const res = await write();
      if (!res.ok) {
        queryClient.setQueryData<Position[]>(SHIFT_POSITIONS_KEY, snapshot);
        if (mounted.current) setWriteError(res.code);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= positions.length) return;
    const ids = positions.map((p) => p.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    void optimistic(
      (prev) => prev.map((p) => ({ ...p, position: ids.indexOf(p.id) })),
      () => runIntentAction("shifts.reorder_positions", { ids }),
    );
  }

  return (
    <>
      <ToolHeader
        title={t("shifts.positionsTitle")}
        subtitle={t("shifts.name")}
        action={<AddButton label={t("shifts.addPosition")} onClick={() => setAdding(true)} />}
      />
      <WriteErrorBanner code={writeError} />

      {adding ? (
        <PositionForm
          mode="modal"
          initialName=""
          positions={positions}
          onSubmit={async (name) => {
            // Appended after the current last one.
            const nextPosition = positions.reduce((max, p) => Math.max(max, p.position + 1), 0);
            const res = await runIntentAction("shifts.create_position", {
              name,
              position: nextPosition,
            });
            if (!res.ok) return res.code;
            const { id } = res.data as { id: string };
            queryClient.setQueryData<Position[]>(SHIFT_POSITIONS_KEY, (prev) => [
              ...(prev ?? []),
              { id, name, position: nextPosition },
            ]);
            return null;
          }}
          onClose={() => setAdding(false)}
        />
      ) : null}

      {isLoading ? (
        <ul className="flex flex-col divide-y divide-hairline" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center justify-between py-sm">
              <span className={`h-5 w-32 ${SKELETON}`} />
              <span className={`h-8 w-24 ${SKELETON}`} />
            </li>
          ))}
        </ul>
      ) : isError ? (
        <EmptyCard titleKey="shifts.loadFailed" />
      ) : positions.length === 0 ? (
        <EmptyCard
          titleKey="shifts.emptyPositionsTitle"
          hintKey="shifts.emptyPositionsHint"
          action={<AddButton label={t("shifts.addPosition")} onClick={() => setAdding(true)} />}
        />
      ) : (
        <ul className="flex flex-col divide-y divide-hairline">
          {positions.map((p, index) => {
            // How many (visible) employees can fill this position.
            const linked = counts.get(p.id) ?? 0;
            // How many shifts still require it (blocks delete).
            const inUse = requiredBy.get(p.id) ?? 0;
            return editingId === p.id ? (
              <li key={p.id} className="py-sm">
                <PositionForm
                  mode="inline"
                  initialName={p.name}
                  editingId={p.id}
                  positions={positions}
                  onSubmit={async (name) => {
                    // Save first, then patch the cache — the form shows any error.
                    const res = await runIntentAction("shifts.rename_position", {
                      id: p.id,
                      name,
                    });
                    if (!res.ok) return res.code;
                    queryClient.setQueryData<Position[]>(SHIFT_POSITIONS_KEY, (prev) =>
                      (prev ?? []).map((it) => (it.id === p.id ? { ...it, name } : it)),
                    );
                    return null;
                  }}
                  onClose={() => setEditingId(null)}
                />
              </li>
            ) : (
              <li key={p.id} className="flex flex-col gap-2xs py-sm">
                <div className="flex items-center gap-xs">
                  <span className="min-w-0 flex-1 truncate type-heading text-ink">{p.name}</span>
                  <span className="shrink-0 type-label text-muted">
                    {count(linked, "shifts.employeesOne", "shifts.employeesMany")}
                  </span>
                  <button
                    type="button"
                    aria-label={t("shifts.moveUp")}
                    onClick={() => move(index, -1)}
                    disabled={busy || index === 0}
                    className={`${arrowButton} ${index === 0 ? "opacity-[var(--ds-disabled-opacity)]" : ""}`}
                  >
                    <ChevronDownIcon width={16} height={16} className="rotate-180" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("shifts.moveDown")}
                    onClick={() => move(index, 1)}
                    disabled={busy || index === positions.length - 1}
                    className={`${arrowButton} ${
                      index === positions.length - 1 ? "opacity-[var(--ds-disabled-opacity)]" : ""
                    }`}
                  >
                    <ChevronDownIcon width={16} height={16} />
                  </button>
                  <RowActions
                    onEdit={() => {
                      setConfirmId(null);
                      setEditingId(p.id);
                    }}
                    confirming={confirmId === p.id}
                    // A position some shift still needs can't be deleted (the DB
                    // refuses it — ON DELETE RESTRICT): explain instead of arming.
                    deleteDisabled={inUse > 0}
                    onArmDelete={() => {
                      if (inUse > 0) {
                        setBlockedId((cur) => (cur === p.id ? null : p.id));
                        return;
                      }
                      setConfirmId(p.id);
                    }}
                    onConfirmDelete={() => {
                      setConfirmId(null);
                      // The DB cascades the employee links — mirror that in the
                      // cache, and restore them if the delete is refused.
                      const linksSnapshot = queryClient.getQueryData<EmployeePosition[]>(
                        SHIFT_EMPLOYEE_POSITIONS_KEY,
                      );
                      void optimistic(
                        (prev) => {
                          queryClient.setQueryData<EmployeePosition[]>(
                            SHIFT_EMPLOYEE_POSITIONS_KEY,
                            (prevLinks) => (prevLinks ?? []).filter((l) => l.positionId !== p.id),
                          );
                          return prev.filter((it) => it.id !== p.id);
                        },
                        async () => {
                          const res = await runIntentAction("shifts.delete_position", { id: p.id });
                          if (!res.ok) {
                            queryClient.setQueryData<EmployeePosition[]>(
                              SHIFT_EMPLOYEE_POSITIONS_KEY,
                              linksSnapshot,
                            );
                          }
                          return res;
                        },
                      );
                    }}
                    disabled={busy}
                    // Deleting a position takes it away from its employees — say so.
                    confirmLabel={
                      linked === 0
                        ? undefined
                        : linked === 1
                          ? t("shifts.confirmDeleteLinkedOne")
                          : t("shifts.confirmDeleteLinkedMany").replace("{count}", String(linked))
                    }
                  />
                </div>
                {blockedId === p.id && inUse > 0 ? (
                  <p className="type-caption text-muted">
                    {inUse === 1
                      ? t("shifts.positionInUseOne")
                      : t("shifts.positionInUseMany").replace("{count}", String(inUse))}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** Add (modal) or rename (inline) a position — one form for both. */
function PositionForm({
  mode,
  initialName,
  editingId,
  positions,
  onSubmit,
  onClose,
}: {
  mode: "modal" | "inline";
  initialName: string;
  /** The position being renamed (excluded from the duplicate check). */
  editingId?: string;
  positions: readonly Position[];
  /** Performs the write; resolves to the failure code or null. */
  onSubmit: (name: string) => Promise<WriteErrorCode | null>;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const mounted = useMounted();
  const [name, setName] = useState(initialName);
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<WriteErrorCode | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const clean = name.replace(/\s+/g, " ").trim();
  const missing = clean === "";
  const duplicate =
    !missing && positions.some((p) => p.id !== editingId && sameName(p.name, clean, locale));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setShowErrors(true);
    if (missing || duplicate || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const code = await onSubmit(clean);
      if (!mounted.current) return;
      if (code) setError(code);
      else onClose();
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  const fields = (
    <>
      <WriteErrorBanner code={error} />
      <TextField
        label={t("shifts.positionName")}
        value={name}
        onChange={setName}
        placeholder={t("shifts.positionPlaceholder")}
        maxLength={POSITION_NAME_MAX}
        required
        error={
          showErrors && missing
            ? t("shifts.fieldRequired")
            : showErrors && duplicate
              ? t("shifts.nameExists")
              : null
        }
        inputRef={inputRef}
      />
      <FormActions
        submitLabel={t(mode === "modal" ? "shifts.add" : "shifts.save")}
        onCancel={onClose}
        submitting={submitting}
      />
    </>
  );

  return mode === "modal" ? (
    <Modal title={t("shifts.addPosition")} onClose={onClose} onSubmit={handleSubmit}>
      {fields}
    </Modal>
  ) : (
    <form onSubmit={handleSubmit} className="flex flex-col gap-sm rounded-lg bg-card p-md">
      {fields}
    </form>
  );
}
