"use client";

/**
 * Where the user is inside the training tool — kept in the URL's query string
 * so the phone's back button and a refresh behave (same approach as
 * shifts/nav.ts and orders/nav.ts):
 *
 *   (none)        → the active org's plan (or "My plans" when it has none)
 *   ?view=plans   → "My plans"
 *   ?day=<id>     → one training day of the active org's plan
 *
 * Every move PUSHES a history entry, so back (the phone's, or the header's,
 * which is router.back()) returns one level. `window.history.pushState` is
 * synced by Next into `useSearchParams` with no server round-trip.
 */
import { useCallback } from "react";
import { useSearchParams } from "next/navigation";

/** The tool's route (matches `TOOL_VIEWS.training.route`). */
export const TRAINING_ROUTE = "/tools/training";

export type TrainingScreen =
  | { kind: "plan" }
  | { kind: "plans" }
  | { kind: "day"; dayId: string };

export function trainingHref(screen: TrainingScreen): string {
  switch (screen.kind) {
    case "plan":
      return "";
    case "plans":
      return "?view=plans";
    case "day":
      return `?day=${encodeURIComponent(screen.dayId)}`;
  }
}

export function useTrainingNav() {
  const params = useSearchParams();
  const dayId = params.get("day");
  const screen: TrainingScreen =
    params.get("view") === "plans"
      ? { kind: "plans" }
      : dayId
        ? { kind: "day", dayId }
        : { kind: "plan" };

  const go = useCallback((next: TrainingScreen) => {
    const query = trainingHref(next);
    window.history.pushState(null, "", `${window.location.pathname}${query}`);
  }, []);

  return { screen, go };
}
