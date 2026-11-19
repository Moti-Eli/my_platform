"use client";

/**
 * Floating bar — the tasks/shifts bar chrome (`sticky bottom-sm` + `mt-auto`,
 * translucent card, backdrop blur; see tasks' FilterBar header for why sticky,
 * not fixed). Two controls:
 *
 *   My plans   — the list of every plan (marked while it is showing).
 *   + New plan — opens NewPlanModal.
 */
import { useI18n } from "@/i18n";
import { GridIcon, PlusIcon } from "@/components/icons";

export function TrainingBar({
  showingPlans,
  onMyPlans,
  onNewPlan,
}: {
  showingPlans: boolean;
  onMyPlans: () => void;
  onNewPlan: () => void;
}) {
  const { t } = useI18n();
  return (
    <nav
      aria-label={t("training.barLabel")}
      className="sticky bottom-sm z-40 mt-auto flex w-fit shrink-0 items-center gap-2xs self-center rounded-pill border border-hairline bg-card/70 p-2xs shadow-lifted backdrop-blur-md"
    >
      <button
        type="button"
        aria-pressed={showingPlans}
        onClick={onMyPlans}
        className={`flex items-center gap-2xs rounded-pill px-sm py-2xs type-label interactive motion-safe:active:scale-[0.97] ${
          showingPlans ? "bg-app-amber text-on-fill" : "text-muted"
        }`}
      >
        <GridIcon width={16} height={16} aria-hidden />
        {t("training.myPlans")}
      </button>
      <span className="h-5 w-px shrink-0 bg-hairline" aria-hidden="true" />
      <button
        type="button"
        onClick={onNewPlan}
        className="flex items-center gap-2xs rounded-pill px-sm py-2xs type-label text-muted interactive motion-safe:active:scale-[0.97]"
      >
        <PlusIcon width={16} height={16} aria-hidden />
        {t("training.newPlan")}
      </button>
    </nav>
  );
}
