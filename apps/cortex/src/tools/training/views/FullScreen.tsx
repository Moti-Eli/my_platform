"use client";

/**
 * Training full screen (Standard §2 `views/FullScreen.tsx`, §8).
 *
 * Every plan lives in its own org (ARCHITECTURE.md #38), so the first screen
 * depends on the ACTIVE org:
 *   - a plan org    → that plan (stage 1 part A: its name + an empty state;
 *                     days and exercises come in part B)
 *   - any other org → "My plans", the list of every plan the user is in
 * The floating bar switches to "My plans" and opens "New plan" from anywhere.
 */
import { useState } from "react";
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { useTrainingPlan } from "@/lib/query/useTrainingPlan";
import { NewPlanModal } from "./NewPlanModal";
import { PlansScreen } from "./PlansScreen";
import { TrainingBar } from "./TrainingBar";
import { EmptyCard, SKELETON, ToolHeader, useFrequencyLabel } from "./shared";

// userId is NOT sent to any action — the server derives identity from the
// session cookie. orgId is used only to mark/open the active org's plan.
export function FullScreen({ orgId }: ToolViewProps) {
  const { t } = useI18n();
  const frequencyLabel = useFrequencyLabel();
  const { plan, isLoading, isError } = useTrainingPlan();
  const [showPlans, setShowPlans] = useState(false);
  const [creating, setCreating] = useState(false);

  const listView = showPlans || (!isLoading && !isError && !plan);
  const freq = plan ? frequencyLabel(plan.frequencyPerWeek) : null;

  return (
    <>
      <ToolHeader
        title={!listView && plan ? plan.name : t("training.myPlans")}
        subtitle={t("training.name")}
      />

      {creating ? <NewPlanModal onClose={() => setCreating(false)} /> : null}

      {listView ? (
        <PlansScreen
          activeOrgId={orgId}
          onOpenActive={() => setShowPlans(false)}
          onNewPlan={() => setCreating(true)}
        />
      ) : isLoading ? (
        <div className={`h-32 w-full ${SKELETON}`} aria-hidden="true" />
      ) : isError ? (
        <EmptyCard titleKey="training.loadFailed" />
      ) : (
        <>
          {freq || plan?.description ? (
            <div className="flex flex-col gap-2xs">
              {freq ? <p className="type-label text-app-amber">{freq}</p> : null}
              {plan?.description ? (
                <p className="whitespace-pre-line type-body text-muted">{plan.description}</p>
              ) : null}
            </div>
          ) : null}
          <EmptyCard titleKey="training.planEmptyTitle" hintKey="training.planEmptyHint" />
        </>
      )}

      <TrainingBar
        showingPlans={listView}
        onMyPlans={() => setShowPlans(true)}
        onNewPlan={() => setCreating(true)}
      />
    </>
  );
}
