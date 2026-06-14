/**
 * Feature registry — the single declarative wiring point for platform features.
 *
 * See FEATURES.md (repo root) for the full convention. This module is
 * intentionally REACT-FREE and app-agnostic: it holds only metadata, so both the
 * web and mobile apps (and, later, route guards) can read "which features exist"
 * from one place. It must never import `next/*`, `react`, or any app code — apps
 * depend on packages, not the reverse (CLAUDE.md #4).
 *
 * Phase 1 (this milestone): the registry is ADDITIVE infrastructure only.
 * Navigation and route guards do NOT consume it yet — wiring them is a separate,
 * fully-verified phase. The entries below faithfully mirror how the existing
 * screens are gated today.
 */
import type { PermissionKey } from "@platform/auth";

export interface FeatureDefinition {
  /** Stable unique slug. Never reuse or rename casually. */
  id: string;
  /**
   * Route path AFTER the locale prefix — e.g. 'dashboard/chat' ->
   * /[locale]/dashboard/chat, or 'platform' -> /[locale]/platform. Not every
   * feature lives under /dashboard, so this is the full post-locale path rather
   * than a bare segment.
   */
  route: string;
  /** i18n key for the nav label (lives in the feature's i18n namespace). */
  labelKey: string;
  /** Icon identifier; each app maps this to its own icon set. */
  icon?: string;
  /** Permission gate. null/undefined => any authenticated org member may see it. */
  requiredPermission?: PermissionKey | null;
  /** Platform-owner-only (like the existing /platform screen). */
  ownerOnly?: boolean;
  /** Which platforms expose this feature. */
  platforms: Array<"web" | "mobile">;
  /** Build/runtime kill switch. false => hidden everywhere, code stays dormant. */
  enabled: boolean;
  // Future: enabledForOrg?(orgId: string): boolean   // per-tenant enablement
}

/**
 * The three features that exist today, mirroring their REAL gating:
 *
 * - `members` and `chat` are gated only by login + organization membership.
 *   No permission check guards ACCESS today — on the members screen,
 *   `members.manage` only toggles the edit controls, it does not gate viewing —
 *   so `requiredPermission` is null. `users.view` is members' natural permission
 *   key (seeded but not yet enforced anywhere); wire it when guards start
 *   consuming this registry in Phase 2.
 * - `platform` is platform-owner-only (`isPlatformOwner`), living at
 *   /[locale]/platform — outside /dashboard, hence the full route below.
 *
 * `labelKey` uses the convention's `<id>.navLabel` target (those i18n keys are
 * added when nav consumes the registry in Phase 2; today's nav uses its own
 * hardcoded labels and is left untouched).
 */
export const FEATURES: FeatureDefinition[] = [
  {
    id: "members",
    route: "dashboard/members",
    labelKey: "members.navLabel",
    icon: "users",
    requiredPermission: null,
    platforms: ["web", "mobile"],
    enabled: true,
  },
  {
    id: "chat",
    route: "dashboard/chat",
    labelKey: "chat.navLabel",
    icon: "message",
    requiredPermission: null,
    platforms: ["web", "mobile"],
    enabled: true,
  },
  {
    id: "platform",
    route: "platform",
    labelKey: "platform.navLabel",
    icon: "shield",
    ownerOnly: true,
    platforms: ["web", "mobile"],
    enabled: true,
  },
];
