"use client";

/**
 * "New plan" modal — name (required), description and workouts per week
 * (optional). "Create" runs `training.create_plan` (which creates the plan's own
 * org and installs the tool there), then switches to that org and lands in the
 * new plan.
 *
 * The switch is the same as the org switcher's (and shopping's NewListModal):
 * set ORG_COOKIE, then a FULL document load (never router.push) — the
 * react-query cache is not org-scoped, so a soft navigation would keep the
 * previous org's rows on screen.
 */
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { runIntentAction } from "@/cortex/actions";
import { ORG_COOKIE, setPreferenceCookie } from "@/lib/cookies";
import { TRAINING_ROUTE } from "../nav";
import { PlanFields, type PlanDraft } from "./PlanFields";
import { FormActions, Modal, WriteErrorBanner, useMounted, type WriteErrorCode } from "./shared";

export function NewPlanModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const mounted = useMounted();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<PlanDraft>({
    name: "",
    description: "",
    frequencyPerWeek: null,
  });
  const [showRequired, setShowRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [writeError, setWriteError] = useState<WriteErrorCode | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const name = draft.name.trim();
    if (!name) {
      setShowRequired(true);
      return;
    }
    setSubmitting(true);
    setWriteError(null);
    const res = await runIntentAction("training.create_plan", {
      name,
      description: draft.description.trim(),
      frequencyPerWeek: draft.frequencyPerWeek,
    });
    if (!res.ok) {
      if (!mounted.current) return;
      setWriteError(res.code);
      setSubmitting(false);
      return;
    }
    const { orgId } = res.data as { planId: string; orgId: string };
    setPreferenceCookie(ORG_COOKIE, orgId);
    window.location.assign(TRAINING_ROUTE);
  }

  return (
    <Modal title={t("training.newPlanTitle")} onClose={onClose} onSubmit={submit}>
      <WriteErrorBanner code={writeError} />
      <PlanFields
        value={draft}
        onChange={(next) => {
          setDraft(next);
          if (next.name.trim()) setShowRequired(false);
        }}
        showRequired={showRequired}
        inputRef={inputRef}
      />
      <FormActions submitLabel={t("training.create")} onCancel={onClose} submitting={submitting} />
    </Modal>
  );
}
