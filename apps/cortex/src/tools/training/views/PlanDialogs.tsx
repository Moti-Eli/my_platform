"use client";

/**
 * The plan's ☰-menu dialogs (shopping's ListMenu dialogs, re-keyed):
 *
 *   Rename      — the plan's name in `workout_plans` only (via
 *                 training.update_plan, keeping description and frequency);
 *                 the org's name (`<plan name> · <6 chars>`) never changes.
 *   Delete plan — owner only. After a confirmation, `training.delete_plan`: the
 *                 plan with its days and exercises, then its org is hidden, then
 *                 a full load to "/" — the session falls back to the user's
 *                 first org. When refused (not the owner, last org, other
 *                 members) nothing is deleted and the dialog says why.
 */
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n, type MessageKey } from "@/i18n";
import { runIntentAction } from "@/cortex/actions";
import { TRAINING_PLAN_KEY } from "@/lib/query/useTrainingPlan";
import { TRAINING_PLANS_KEY } from "@/lib/query/useTrainingPlans";
import { PLAN_NAME_MAX, type DeletePlanResult, type Plan } from "../logic";
import { PlanFields, type PlanDraft } from "./PlanFields";
import {
  Dialog,
  FieldLabel,
  FormActions,
  Modal,
  WriteErrorBanner,
  inputClass,
  invalidRing,
  useMounted,
  type WriteErrorCode,
} from "./shared";

/** What the delete dialog says when the delete was refused. */
const REFUSAL_KEY: Record<Extract<DeletePlanResult, { error: string }>["error"], MessageKey> = {
  notOwner: "training.deleteRefusedNotOwner",
  lastOrg: "training.deleteRefusedLastOrg",
  otherMembers: "training.deleteRefusedOtherMembers",
  hideFailed: "training.deleteHideFailed",
};

export function RenamePlanModal({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const mounted = useMounted();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(plan.name);
  const [showRequired, setShowRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [writeError, setWriteError] = useState<WriteErrorCode | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setShowRequired(true);
      return;
    }
    if (trimmed === plan.name) {
      onClose();
      return;
    }
    setSubmitting(true);
    setWriteError(null);
    const res = await runIntentAction("training.update_plan", {
      id: plan.id,
      name: trimmed,
      description: plan.description,
      frequencyPerWeek: plan.frequencyPerWeek,
    });
    if (!mounted.current) return;
    setSubmitting(false);
    if (!res.ok) {
      setWriteError(res.code);
      return;
    }
    queryClient.setQueryData<Plan | null>(TRAINING_PLAN_KEY, (prev) =>
      prev ? { ...prev, name: trimmed } : prev,
    );
    void queryClient.invalidateQueries({ queryKey: TRAINING_PLANS_KEY });
    onClose();
  }

  return (
    <Modal title={t("training.renamePlan")} onClose={onClose} onSubmit={submit}>
      <WriteErrorBanner code={writeError} />
      <label className="flex flex-col gap-2xs type-label text-muted">
        <FieldLabel label={t("training.planName")} required />
        <input
          ref={inputRef}
          type="text"
          className={showRequired ? `${inputClass} ${invalidRing}` : inputClass}
          value={name}
          maxLength={PLAN_NAME_MAX}
          onChange={(e) => {
            setName(e.target.value);
            if (e.target.value.trim()) setShowRequired(false);
          }}
          aria-required="true"
          aria-invalid={showRequired ? true : undefined}
        />
        {showRequired ? (
          <span role="alert" className="type-caption text-danger">
            {t("training.planNameRequired")}
          </span>
        ) : null}
      </label>
      <FormActions submitLabel={t("training.save")} onCancel={onClose} submitting={submitting} />
    </Modal>
  );
}

/** Edit name, description and workouts per week (training.update_plan). */
export function EditPlanModal({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const mounted = useMounted();
  const [draft, setDraft] = useState<PlanDraft>({
    name: plan.name,
    description: plan.description,
    frequencyPerWeek: plan.frequencyPerWeek,
  });
  const [showRequired, setShowRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [writeError, setWriteError] = useState<WriteErrorCode | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const name = draft.name.trim();
    if (!name) {
      setShowRequired(true);
      return;
    }
    const next = { name, description: draft.description.trim(), frequencyPerWeek: draft.frequencyPerWeek };
    setSubmitting(true);
    setWriteError(null);
    const res = await runIntentAction("training.update_plan", { id: plan.id, ...next });
    if (!mounted.current) return;
    setSubmitting(false);
    if (!res.ok) {
      setWriteError(res.code);
      return;
    }
    queryClient.setQueryData<Plan | null>(TRAINING_PLAN_KEY, (prev) =>
      prev ? { ...prev, ...next } : prev,
    );
    void queryClient.invalidateQueries({ queryKey: TRAINING_PLANS_KEY });
    onClose();
  }

  return (
    <Modal title={t("training.editPlan")} onClose={onClose} onSubmit={submit}>
      <WriteErrorBanner code={writeError} />
      <PlanFields
        value={draft}
        onChange={(next) => {
          setDraft(next);
          if (next.name.trim()) setShowRequired(false);
        }}
        showRequired={showRequired}
      />
      <FormActions submitLabel={t("training.save")} onCancel={onClose} submitting={submitting} />
    </Modal>
  );
}

export function DeletePlanDialog({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const { t } = useI18n();
  const mounted = useMounted();
  const [submitting, setSubmitting] = useState(false);
  const [writeError, setWriteError] = useState<WriteErrorCode | null>(null);
  const [refusal, setRefusal] = useState<MessageKey | null>(null);

  async function confirm() {
    if (submitting) return;
    setSubmitting(true);
    setWriteError(null);
    setRefusal(null);
    const res = await runIntentAction("training.delete_plan", { id: plan.id });
    if (!res.ok) {
      if (!mounted.current) return;
      setSubmitting(false);
      setWriteError(res.code);
      return;
    }
    const result = res.data as DeletePlanResult;
    if ("error" in result) {
      if (!mounted.current) return;
      setSubmitting(false);
      setRefusal(REFUSAL_KEY[result.error]);
      return;
    }
    // FULL load (as the org switcher): the hidden org drops out of the session,
    // which falls back to the user's first org.
    window.location.assign("/");
  }

  return (
    <Dialog title={t("training.deletePlanTitle")} onClose={onClose}>
      <WriteErrorBanner code={writeError} />
      {refusal ? (
        <p role="alert" className="rounded-md bg-danger/10 px-sm py-xs type-label text-danger">
          {t(refusal)}
        </p>
      ) : (
        <p className="type-body text-muted">
          {t("training.deletePlanBody").replace("{name}", plan.name)}
        </p>
      )}
      <div className="flex gap-sm pt-xs">
        {refusal ? null : (
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={submitting}
            className="flex-1 rounded-md bg-danger py-sm type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
          >
            {t("training.deletePlanConfirm")}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="flex-1 rounded-md bg-hairline py-sm type-label text-ink interactive motion-safe:active:scale-[0.97]"
        >
          {t(refusal ? "training.close" : "training.cancel")}
        </button>
      </div>
    </Dialog>
  );
}
