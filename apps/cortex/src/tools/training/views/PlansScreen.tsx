"use client";

/**
 * "My plans" — every workout plan the user is in, across all their orgs (each
 * plan lives in its own org — ARCHITECTURE.md #38). The plan of the ACTIVE org
 * is marked. Tapping a plan opens it: the active org's plan opens in place;
 * any other plan switches to its org (ORG_COOKIE + a FULL document load, as the
 * org switcher does — the react-query cache is not org-scoped).
 */
import { useI18n } from "@/i18n";
import { ChevronIcon, SparkIcon } from "@/components/icons";
import { ORG_COOKIE, setPreferenceCookie } from "@/lib/cookies";
import { useTrainingPlans } from "@/lib/query/useTrainingPlans";
import type { Plan } from "../logic";
import { TRAINING_ROUTE } from "../nav";
import { AddButton, EmptyCard, SKELETON, useFrequencyLabel } from "./shared";

export function PlansScreen({
  activeOrgId,
  onOpenActive,
  onNewPlan,
}: {
  activeOrgId: string;
  /** Open the active org's plan without switching org. */
  onOpenActive: () => void;
  onNewPlan: () => void;
}) {
  const { t, dir } = useI18n();
  const frequencyLabel = useFrequencyLabel();
  const { plans, isLoading, isError } = useTrainingPlans();

  function open(plan: Plan) {
    if (plan.orgId === activeOrgId) {
      onOpenActive();
      return;
    }
    setPreferenceCookie(ORG_COOKIE, plan.orgId);
    window.location.assign(TRAINING_ROUTE);
  }

  if (isLoading) {
    return (
      <ul className="flex flex-col gap-xs" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <li key={i} className={`h-16 w-full ${SKELETON}`} />
        ))}
      </ul>
    );
  }
  if (isError) return <EmptyCard titleKey="training.loadFailed" />;
  if (plans.length === 0) {
    return (
      <EmptyCard
        titleKey="training.noPlansTitle"
        hintKey="training.noPlansHint"
        action={<AddButton label={t("training.newPlan")} onClick={onNewPlan} />}
      />
    );
  }

  return (
    <ul className="flex flex-col gap-xs">
      {plans.map((plan) => {
        const active = plan.orgId === activeOrgId;
        const freq = frequencyLabel(plan.frequencyPerWeek);
        return (
          <li key={plan.id}>
            <button
              type="button"
              onClick={() => open(plan)}
              aria-label={`${t("training.openPlan")}: ${plan.name}`}
              className="flex w-full items-center gap-sm rounded-lg bg-card p-md text-start interactive motion-safe:active:scale-[0.99]"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-app-amber/15 text-app-amber">
                <SparkIcon width={20} height={20} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex min-w-0 items-center gap-xs">
                  <span className="truncate type-heading text-ink">{plan.name}</span>
                  {active ? (
                    <span className="shrink-0 rounded-pill bg-app-amber/15 px-xs py-2xs type-caption text-app-amber">
                      {t("training.activePlan")}
                    </span>
                  ) : null}
                </span>
                {freq || plan.description ? (
                  <span className="truncate type-label text-muted">
                    {[freq, plan.description].filter(Boolean).join(" · ")}
                  </span>
                ) : null}
              </span>
              <ChevronIcon
                aria-hidden
                className="shrink-0 text-muted"
                style={{ transform: dir === "rtl" ? undefined : "scaleX(-1)" }}
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
