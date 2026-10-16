"use client";

/**
 * The single route behind every profile drill-in row. It resolves the `[key]`
 * segment to a title and renders the shared {@link PlaceholderScreen}; unknown
 * keys fall back to the profile title. No per-row page exists.
 */
import { useParams } from "next/navigation";
import { PlaceholderScreen } from "@/components/profile/PlaceholderScreen";
import { PLACEHOLDER_TITLES, type PlaceholderKey } from "@/components/profile/placeholders";
import { useI18n } from "@/i18n";

export function ProfileSectionView() {
  const { t } = useI18n();
  const params = useParams<{ key: string }>();
  const titleKey = PLACEHOLDER_TITLES[params.key as PlaceholderKey] ?? "profile.title";
  return <PlaceholderScreen title={t(titleKey)} />;
}
