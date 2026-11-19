"use client";

/**
 * Training full screen (Standard §2 `views/FullScreen.tsx`, §8).
 *
 * Every plan lives in its own org (ARCHITECTURE.md #38), so the first screen
 * depends on the ACTIVE org:
 *   - a plan org    → that plan (details + training days)
 *   - any other org → "My plans", the list of every plan the user is in
 * From the plan, a day opens the day screen; the header's back steps up one
 * level (day → plan, My plans → plan) and leaves the tool from the top.
 *
 * The floating bar (☰ + 🔍, the orders bar's shape) carries every occasional
 * action: New plan, My plans, Rename, Delete plan (owner only). Search filters
 * the list on the current screen and is cleared whenever the screen changes.
 */
import { useState } from "react";
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { useTrainingPlan } from "@/lib/query/useTrainingPlan";
import { useTrainingDays } from "@/lib/query/useTrainingDays";
import { useTrainingExercises } from "@/lib/query/useTrainingExercises";
import { DayScreen, useExerciseSummary } from "./DayScreen";
import { NewPlanModal } from "./NewPlanModal";
import { DeletePlanDialog, RenamePlanModal } from "./PlanDialogs";
import { PlanScreen } from "./PlanScreen";
import { PlansScreen } from "./PlansScreen";
import { TrainingBar, type BarMenuItem } from "./TrainingBar";
import { EmptyCard, SKELETON, ToolHeader } from "./shared";

type Overlay = "new" | "rename" | "delete" | null;
/** "plan" = the active org's plan (or My plans when it has none). */
type Screen = { kind: "plan" } | { kind: "plans" } | { kind: "day"; dayId: string };

// userId is NOT sent to any action — the server derives identity from the
// session cookie. It is used only to show "Delete plan" to the owner (the
// server re-checks). orgId marks/opens the active org's plan.
export function FullScreen({ userId, orgId }: ToolViewProps) {
  const { t } = useI18n();
  const { plan, isLoading, isError } = useTrainingPlan();
  const { days } = useTrainingDays();
  const exercisesQ = useTrainingExercises();
  const summary = useExerciseSummary();
  const [screen, setScreen] = useState<Screen>({ kind: "plan" });
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [search, setSearch] = useState("");

  function go(next: Screen) {
    setSearch("");
    setScreen(next);
  }

  const listView = screen.kind === "plans" || (!isLoading && !isError && !plan);
  const openPlan = !listView ? plan : null;
  const openDay =
    openPlan && screen.kind === "day" ? (days.find((d) => d.id === screen.dayId) ?? null) : null;

  const menu: BarMenuItem[] = [
    { labelKey: "training.newPlan", onSelect: () => setOverlay("new") },
    { labelKey: "training.myPlans", onSelect: () => go({ kind: "plans" }) },
  ];
  if (openPlan) {
    menu.push({ labelKey: "training.renamePlan", onSelect: () => setOverlay("rename") });
    if (openPlan.ownerId === userId) {
      menu.push({ labelKey: "training.deletePlan", onSelect: () => setOverlay("delete"), danger: true });
    }
  }

  // Back steps up inside the tool; from the top it leaves (router.back()).
  const onBack =
    (screen.kind === "plans" && plan) || screen.kind === "day"
      ? () => go({ kind: "plan" })
      : undefined;

  return (
    <>
      <ToolHeader
        title={openDay ? openDay.name : openPlan ? openPlan.name : t("training.myPlans")}
        subtitle={openDay && openPlan ? openPlan.name : t("training.name")}
        onBack={onBack}
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
          onOpenActive={() => go({ kind: "plan" })}
          onNewPlan={() => setOverlay("new")}
        />
      ) : isLoading ? (
        <div className={`h-32 w-full ${SKELETON}`} aria-hidden="true" />
      ) : isError || !openPlan ? (
        <EmptyCard titleKey="training.loadFailed" />
      ) : openDay ? (
        <DayScreen day={openDay} search={search} />
      ) : (
        <PlanScreen
          plan={openPlan}
          search={search}
          onOpenDay={(dayId) => go({ kind: "day", dayId })}
          dayMeta={
            exercisesQ.isSuccess
              ? (day) => summary(exercisesQ.exercises.filter((e) => e.dayId === day.id))
              : undefined
          }
        />
      )}

      <TrainingBar search={search} onSearchChange={setSearch} menu={menu} />
    </>
  );
}
