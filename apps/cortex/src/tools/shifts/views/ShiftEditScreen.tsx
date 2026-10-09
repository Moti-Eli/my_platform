"use client";

/**
 * One shift's edit screen (?shift=<id>): name and hours, and delete behind a
 * confirmation. Part 4 adds the requirements (how many of each position) here.
 *
 * Saving or deleting goes back to the day view (history back — the day view is
 * the entry the user came from).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { runIntentAction } from "@/cortex/actions";
import type { ShiftTemplate } from "../logic";
import { weekdayLong } from "../time";
import {
  SHIFT_REQUIREMENTS_KEY,
  SHIFT_TEMPLATES_KEY,
  useShiftTemplates,
} from "@/lib/query/useShiftTemplates";
import { ShiftFields } from "./ShiftForm";
import {
  EmptyCard,
  SKELETON,
  ToolHeader,
  WriteErrorBanner,
  useMounted,
  type WriteErrorCode,
} from "./shared";

export function ShiftEditScreen({ shiftId }: { shiftId: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const mounted = useMounted();
  const { templates, isLoading, isError } = useShiftTemplates();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<WriteErrorCode | null>(null);

  const shift = templates.find((tpl) => tpl.id === shiftId);

  if (isLoading) {
    return (
      <>
        <ToolHeader title={t("shifts.editShift")} subtitle={t("shifts.name")} />
        <div className={`h-40 ${SKELETON}`} aria-hidden="true" />
      </>
    );
  }
  if (isError) {
    return (
      <>
        <ToolHeader title={t("shifts.editShift")} subtitle={t("shifts.name")} />
        <EmptyCard titleKey="shifts.loadFailed" />
      </>
    );
  }
  if (!shift) {
    return (
      <>
        <ToolHeader title={t("shifts.editShift")} subtitle={t("shifts.name")} />
        <EmptyCard titleKey="shifts.shiftNotFound" hintKey="shifts.shiftNotFoundHint" />
      </>
    );
  }

  const dayName = weekdayLong(shift.weekday, locale);
  const dayShifts = templates.filter((tpl) => tpl.weekday === shift.weekday);

  async function remove() {
    if (deleting || !shift) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await runIntentAction("shifts.delete_template", { id: shift.id });
      if (!mounted.current) return;
      if (res.ok) {
        queryClient.setQueryData<ShiftTemplate[]>(SHIFT_TEMPLATES_KEY, (prev) =>
          (prev ?? []).filter((tpl) => tpl.id !== shift.id),
        );
        // Its requirements cascaded in the DB.
        void queryClient.invalidateQueries({ queryKey: SHIFT_REQUIREMENTS_KEY });
        router.back();
      } else {
        setDeleteError(res.code);
      }
    } finally {
      if (mounted.current) setDeleting(false);
    }
  }

  return (
    <>
      <ToolHeader title={shift.name} subtitle={`${t("shifts.editShift")} · ${dayName}`} />

      <div className="rounded-lg bg-card p-md">
        <ShiftFields
          // Re-key on the saved values so a successful save resets the form.
          key={`${shift.name}|${shift.startTime}|${shift.endTime}`}
          initial={{ name: shift.name, startTime: shift.startTime, endTime: shift.endTime }}
          dayShifts={dayShifts}
          editingId={shift.id}
          submitLabel={t("shifts.save")}
          onSubmit={async (draft) => {
            const res = await runIntentAction("shifts.update_template", {
              id: shift.id,
              ...draft,
            });
            if (!res.ok) return res.code;
            queryClient.setQueryData<ShiftTemplate[]>(SHIFT_TEMPLATES_KEY, (prev) =>
              (prev ?? []).map((tpl) => (tpl.id === shift.id ? { ...tpl, ...draft } : tpl)),
            );
            router.back();
            return null;
          }}
          onCancel={() => router.back()}
        />
      </div>

      <p className="type-caption text-muted">{t("shifts.requirementsSoon")}</p>

      {/* Delete — behind a confirmation. */}
      <WriteErrorBanner code={deleteError} />
      {confirmingDelete ? (
        <div role="alert" className="flex flex-col gap-xs rounded-md bg-danger/10 px-sm py-xs">
          <p className="type-label text-danger">
            {t("shifts.confirmDeleteShift").replace("{name}", shift.name)}
          </p>
          <div className="flex gap-xs">
            <button
              type="button"
              disabled={deleting}
              onClick={() => void remove()}
              className="rounded-pill bg-danger px-sm py-2xs type-caption text-on-fill interactive motion-safe:active:scale-[0.97]"
            >
              {t("shifts.confirmDeleteYes")}
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={() => setConfirmingDelete(false)}
              className="rounded-pill bg-hairline px-sm py-2xs type-caption text-ink interactive motion-safe:active:scale-[0.97]"
            >
              {t("shifts.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          className="self-start type-label text-danger underline interactive"
        >
          {t("shifts.deleteShift")}
        </button>
      )}
    </>
  );
}
