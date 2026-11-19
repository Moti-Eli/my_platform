"use client";

/**
 * Training dashboard card (Standard §2 `views/DashboardCard.tsx`, §8), on the
 * app-amber identity accent, same chrome and fixed height (~1/3 of the visible
 * viewport, from `--app-vh`) as the shopping card.
 *
 * Every plan lives in its own org (ARCHITECTURE.md #38), so the card depends on
 * the ACTIVE org:
 *   - a plan org    → the plan's name, how many training days it has, workouts
 *                     per week and description. Tapping opens the tool.
 *   - any other org → "Create plan", which opens the same NewPlanModal as the
 *                     full screen.
 *
 * STATES, MODELLED EXPLICITLY: loading → skeleton; error → a muted "couldn't
 * load" line, never silently blank. Reads the SAME shared cache as the full
 * screen, so the card and the tool never disagree.
 *
 * TAPS: Home wraps this card in a `<Link>` to the tool. The "Create plan" button
 * calls BOTH `preventDefault` and `stopPropagation`; the modal is PORTALLED to
 * <body> and wrapped in a stopPropagation — exactly as shopping's card does.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import type { ToolViewProps } from "@/tools";
import { useI18n } from "@/i18n";
import { PlusIcon, SparkIcon } from "@/components/icons";
import { useTrainingPlan } from "@/lib/query/useTrainingPlan";
import { useTrainingDays } from "@/lib/query/useTrainingDays";
import { NewPlanModal } from "./NewPlanModal";
import { SKELETON, useFrequencyLabel } from "./shared";

// userId/orgId arrive as props but are never sent anywhere: the server action
// derives identity from the session cookie.
export function DashboardCard(_props: ToolViewProps) {
  const { t } = useI18n();
  const frequencyLabel = useFrequencyLabel();
  const { plan, isLoading, isError } = useTrainingPlan();
  const [creating, setCreating] = useState(false);
  const freq = plan ? frequencyLabel(plan.frequencyPerWeek) : null;

  return (
    <div
      className="flex flex-col rounded-lg bg-card p-md"
      style={{ height: "calc(var(--app-vh, 100dvh) / 3)" }}
    >
      <div className="mb-sm flex shrink-0 items-center justify-between gap-xs">
        <div className="flex min-w-0 items-center gap-xs">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-app-amber/15 text-app-amber">
            <SparkIcon width={20} height={20} />
          </span>
          <div className="flex min-w-0 flex-col">
            {plan ? (
              <span className="truncate type-label text-muted">{t("training.name")}</span>
            ) : null}
            <span className="truncate type-heading text-ink">
              {plan ? plan.name : t("training.name")}
            </span>
          </div>
        </div>
        {!isLoading && !isError && !plan ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setCreating(true);
            }}
            className="flex shrink-0 items-center gap-2xs rounded-pill bg-app-amber px-sm py-xs type-label text-on-fill interactive motion-safe:active:scale-[0.97]"
          >
            <PlusIcon width={14} height={14} aria-hidden />
            {t("training.createPlan")}
          </button>
        ) : null}
      </div>

      {/* The scrolling region — the only part that grows past the fixed height. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <span className={`block h-4 w-32 ${SKELETON}`} aria-hidden="true" />
        ) : isError ? (
          <p className="type-label text-muted">{t("training.loadFailed")}</p>
        ) : plan ? (
          <div className="flex flex-col gap-2xs">
            <DayCount />
            {freq ? <p className="type-label text-app-amber">{freq}</p> : null}
            {plan.description ? (
              <p className="whitespace-pre-line type-body text-muted">{plan.description}</p>
            ) : null}
          </div>
        ) : (
          <p className="type-label text-muted">{t("training.noPlanHere")}</p>
        )}
      </div>

      {creating && typeof document !== "undefined"
        ? createPortal(
            <div
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              className="contents"
            >
              <NewPlanModal onClose={() => setCreating(false)} />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/** "N training days" — only mounted in a plan org. Reads the same days cache
 *  as the plan screen. */
function DayCount() {
  const { t } = useI18n();
  const { days, isLoading, isError } = useTrainingDays();
  if (isLoading) return <span className={`block h-4 w-24 ${SKELETON}`} aria-hidden="true" />;
  if (isError) return <p className="type-label text-muted">{t("training.loadFailed")}</p>;
  return (
    <p className="type-body text-ink">
      {days.length === 0
        ? t("training.daysNone")
        : days.length === 1
          ? t("training.daysOne")
          : t("training.daysMany").replace("{count}", String(days.length))}
    </p>
  );
}
