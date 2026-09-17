/**
 * Task categories — the single place the closed set of category keys, their
 * i18n label, and their identity color live. `tasks.category` on the DB row
 * is free-form TEXT with no CHECK constraint (the migration deliberately left
 * it open so new categories don't need a schema change) — so THIS list is a
 * UI-side closed set, not a schema-enforced one. A stored value that predates
 * or postdates this list is handled by `categoryOf` returning null, exactly
 * like "no category" — never a rendering error.
 *
 * Colors are written as full static Tailwind class strings (never
 * interpolated, never hex) so Tailwind's scanner detects them — the same
 * convention `app-visuals.tsx`'s `COLOR_CLASSES` uses for the same reason.
 * Every color is one of the app-identity palette tokens (Standard §8): this
 * is a category's own IDENTITY, not a semantic-role color like danger/warning.
 */
import type { MessageKey } from "@/i18n";

export interface TaskCategory {
  /** The exact string stored in `tasks.category`. */
  key: string;
  /** i18n key for the display name. */
  labelKey: MessageKey;
  /** Solid fill for the small dot shown on a task row. */
  dotClassName: string;
  /** Selected-state classes for the category picker: a tint + ring in the
   * category's OWN color, so the chosen option reads by its own identity
   * rather than a generic unrelated accent. */
  selectedClassName: string;
}

export const CATEGORIES: TaskCategory[] = [
  {
    key: "daily",
    labelKey: "tasks.categoryDaily",
    dotClassName: "bg-app-green",
    selectedClassName: "bg-app-green/15 ring-1 ring-app-green text-app-green",
  },
  {
    key: "work",
    labelKey: "tasks.categoryWork",
    dotClassName: "bg-app-blue",
    selectedClassName: "bg-app-blue/15 ring-1 ring-app-blue text-app-blue",
  },
  {
    key: "business",
    labelKey: "tasks.categoryBusiness",
    dotClassName: "bg-app-coral",
    selectedClassName: "bg-app-coral/15 ring-1 ring-app-coral text-app-coral",
  },
];

/** Look up a stored category value. Returns null for BOTH "no category"
 * (empty/null/undefined) and an unrecognized value — callers never need to
 * special-case "unknown" separately from "none". */
export function categoryOf(value: string | null | undefined): TaskCategory | null {
  if (!value) return null;
  return CATEGORIES.find((c) => c.key === value) ?? null;
}
