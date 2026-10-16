/**
 * Route-level loading UI for /profile and its drill-in routes (they inherit
 * this segment's loading.tsx — intended). Overrides the group-level
 * app/(app)/loading.tsx, whose dashboard-card skeletons look nothing like the
 * full-bleed profile screen; the shared ScreenSkeleton renders the screen's own
 * fixed top bar because AppShell mounts no header for full-bleed routes.
 */
import { ScreenSkeleton } from "@/components/profile/ScreenSkeleton";

export default function ProfileLoading() {
  return <ScreenSkeleton />;
}
