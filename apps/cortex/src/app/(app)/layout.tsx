import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";

/**
 * The shell layout: header, app-tabs row, bottom TabBar, AI sheet, urgency inbox.
 * Every screen in this group renders inside it. The `(app)` group name is a
 * grouping device only — it does NOT appear in any URL, so `/`, `/catalog`,
 * `/settings`, `/tools/inventory` are all exactly where they were.
 *
 * ============================================================================
 * THIS LAYOUT PROVIDES CHROME ONLY. IT MUST NEVER CALL requireSession().
 * ============================================================================
 * Every page in this group calls the guard ITSELF, and that is deliberate — do
 * not "consolidate" it up here. It looks like obvious duplication. It is not.
 *
 * WHY: a Next layout does not reliably re-run on client-side navigation. Mount it
 * once, and every subsequent client-side route change renders inside a layout
 * whose guard ran against a session that may since have expired, been revoked, or
 * been signed out in another tab. The guard would fire once and then be TRUSTED
 * for the rest of the session — which is precisely the failure mode we rejected
 * when we refused to protect routes in `src/proxy.ts`. A guard that runs once and
 * is believed forever is not a guard; moving it from the proxy into a layout only
 * changes the hat it is wearing.
 *
 * The per-page call is what makes each page its own boundary. Cheap, boring,
 * and correct. If you are about to move it here to remove the repetition, the
 * repetition IS the feature — see src/lib/session.ts for the whole surface.
 */
export default function AppGroupLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
