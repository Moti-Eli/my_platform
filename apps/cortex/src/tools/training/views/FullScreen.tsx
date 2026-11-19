"use client";

/**
 * Training full screen (Standard §2 `views/FullScreen.tsx`, §8).
 *
 * Every plan lives in its own org (ARCHITECTURE.md #38), so the first screen
 * depends on the ACTIVE org:
 *   - a plan org    → that plan
 *   - any other org → "My plans", the list of every plan the user is in
 * The floating bar (☰ + 🔍, the orders bar's shape) carries every occasional
 * action: New plan, My plans, Rename, Delete plan (owner only). Search filters
 * the list on the current screen and is cleared whenever the screen changes.
 */
import { useState } from "react";
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { useTrainingPlan } from "@/lib/query/useTrainingPlan";
import { NewPlanModal } from "./NewPlanModal";
import { DeletePlanDialog, RenamePlanModal } from "./PlanDialogs";
import { PlansScreen } from "./PlansScreen";
import { TrainingBar, type BarMenuItem } from "./TrainingBar";
import { EmptyCard, SKELETON, ToolHeader, useFrequencyLabel } from "./shared";

type Overlay = "new" | "rename" | "delete" | null;

// userId is NOT sent to any action — the server derives identity from the
// session cookie. It is used only to show "Delete plan" to the owner (the
// server re-checks). orgId marks/opens the active org's plan.
export function FullScreen({ userId, orgId }: ToolViewProps) {
  const { t } = useI18n();
  const frequencyLabel = useFrequencyLabel();
  const { plan, isLoading, isError } = useTrainingPlan();
  const [showPlans, setShowPlans] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [search, setSearch] = useState("");

  const listView = showPlans || (!isLoading && !isError && !plan);
  const openPlan = !listView ? plan : null;
  const freq = openPlan ? frequencyLabel(openPlan.frequencyPerWeek) : null;

  function go(toPlans: boolean) {
    setSearch("");
    setShowPlans(toPlans);
  }

  const menu: BarMenuItem[] = [
    { labelKey: "training.newPlan", onSelect: () => setOverlay("new") },
    { labelKey: "training.myPlans", onSelect: () => go(true) },
  ];
  if (openPlan) {
    menu.push({ labelKey: "training.renamePlan", onSelect: () => setOverlay("rename") });
    if (openPlan.ownerId === userId) {
      menu.push({ labelKey: "training.deletePlan", onSelect: () => setOverlay("delete"), danger: true });
    }
  }

  return (
    <>
      <ToolHeader
        title={openPlan ? openPlan.name : t("training.myPlans")}
        subtitle={t("training.name")}
        // From "My plans" opened over a plan, back returns to that plan.
        onBack={showPlans && plan ? () => go(false) : undefined}
      />

      {overlay === "new" ? <NewPlanModal onClose={() => setOverlay(null)} /> : null}
      {overlay === "rename" && openPlan ? (
        <RenamePlanModal plan={openPlan} onClose={() => setOverlay(null)} />
      ) : null}
      {overlay === "delete" && openPlan ? (
        <DeletePlanDialog plan={openPlan} onClose={() => setOverlay(null)} />
      ) : null}

      {listView ? (
        <PlansScreen
          activeOrgId={orgId}
          search={search}
          onOpenActive={() => go(false)}
          onNewPlan={() => setOverlay("new")}
        />
      ) : isLoading ? (
        <div className={`h-32 w-full ${SKELETON}`} aria-hidden="true" />
      ) : isError ? (
        <EmptyCard titleKey="training.loadFailed" />
      ) : (
        <>
          {freq || openPlan?.description ? (
            <div className="flex flex-col gap-2xs">
              {freq ? <p className="type-label text-app-amber">{freq}</p> : null}
              {openPlan?.description ? (
                <p className="whitespace-pre-line type-body text-muted">{openPlan.description}</p>
              ) : null}
            </div>
          ) : null}
          <EmptyCard titleKey="training.planEmptyTitle" hintKey="training.planEmptyHint" />
        </>
      )}

      <TrainingBar search={search} onSearchChange={setSearch} menu={menu} />
    </>
  );
}
