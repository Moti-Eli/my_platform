/**
 * Route-level loading UI for /settings and its subroutes (appearance /
 * language / version inherit this segment's loading.tsx — intended). Overrides
 * the group-level app/(app)/loading.tsx, whose dashboard-card skeletons look
 * nothing like the full-bleed settings screen; the shared ScreenSkeleton
 * renders the screen's own fixed top bar because AppShell mounts no header for
 * full-bleed routes.
 */
import { ScreenSkeleton } from "@/components/profile/ScreenSkeleton";

export default function SettingsLoading() {
  return <ScreenSkeleton />;
}
