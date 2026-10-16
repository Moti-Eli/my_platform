import type { MessageKey } from "@/i18n";

/**
 * The profile drill-in rows that lead to a not-yet-built screen. A SINGLE dynamic
 * route (`/profile/s/[key]`) renders {@link PlaceholderScreen} for each of these,
 * so there are no bespoke pages. The key is the URL segment; the value is the
 * title shown in the top bar. `apps-summary` will later read the registry via
 * intents (like the chips row) — it stays an empty placeholder for now, never a
 * hardcoded app list.
 */
export const PLACEHOLDER_TITLES = {
  "identity-card": "profile.identityCard",
  "personal-details": "profile.personalDetails",
  organizations: "profile.organizations",
  "apps-summary": "profile.appsSummary",
  documents: "profile.documents",
  "recent-activity": "profile.recentActivity",
  "ai-activity": "profile.aiActivity",
} satisfies Record<string, MessageKey>;

export type PlaceholderKey = keyof typeof PLACEHOLDER_TITLES;

/** The route for a profile drill-in placeholder. */
export function placeholderRoute(key: PlaceholderKey): string {
  return `/profile/s/${key}`;
}
