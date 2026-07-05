/**
 * Dashboard card registry — the capability-filtered card list the restyled
 * dashboard renders. Same gate semantics as `@platform/core` FeatureDefinition
 * (ownerOnly / requiredPermission / null), plus two dashboard realities:
 *
 * - `href`: cards with a destination navigate to the EXISTING screens (chat,
 *   members, platform) — their routes and the screens' own access rules are
 *   untouched. Cards without an href are "coming soon" placeholders.
 * - `requiresOrganization`: org-scoped destinations (chat, members) only make
 *   sense for users who belong to an organization — the exact rule the old
 *   dashboard nav applied (e.g. a platform owner with no membership sees the
 *   platform card but not chat).
 *
 * Card visibility is UI convenience, NOT a security boundary: every real
 * destination screen keeps enforcing its own access server-side, exactly as
 * before this restyle.
 */
import type { PermissionKey } from "@platform/auth";

export type CardTone = "primary" | "success" | "warning" | "owner";
export type CardGlyph = "dots" | "bars" | "rings" | "diamond" | "chat";

export interface DashboardCard {
  /** Stable slug (matches the feature id for real destinations). */
  id: string;
  /** Dotted i18n keys resolved against the root catalog (e.g. "dashboard.openChat"). */
  titleKey: string;
  descKey: string;
  /** Optional access badge on gated cards ("Admins only" / "Owner only"). */
  badgeKey?: string;
  /** Geometric glyph + accent tone (presentation only). */
  glyph: CardGlyph;
  tone: CardTone;
  /** Post-locale route of the EXISTING screen; absent => coming-soon placeholder. */
  href?: string;
  /** Gate — same semantics as FeatureDefinition. null => everyone. */
  requiredPermission?: PermissionKey | null;
  ownerOnly?: boolean;
  /** Additional org-membership gate (the old dashboard nav rule for org links). */
  requiresOrganization?: boolean;
}

export const DASHBOARD_CARDS: DashboardCard[] = [
  {
    id: "chat",
    titleKey: "dashboard.openChat",
    descKey: "dashboard.openChatDesc",
    glyph: "chat",
    tone: "primary",
    href: "/dashboard/chat",
    requiredPermission: null,
    requiresOrganization: true,
  },
  {
    id: "members",
    titleKey: "dashboard.manageMembers",
    descKey: "dashboard.manageMembersDesc",
    badgeKey: "home.badgeAdmin",
    glyph: "rings",
    tone: "warning",
    href: "/dashboard/members",
    requiredPermission: "members.manage",
    requiresOrganization: true,
  },
  {
    id: "platform",
    titleKey: "dashboard.platformAdmin",
    descKey: "dashboard.platformAdminDesc",
    badgeKey: "home.badgeOwner",
    glyph: "diamond",
    tone: "owner",
    href: "/platform",
    ownerOnly: true,
  },
  {
    id: "schedule",
    titleKey: "home.cardScheduleTitle",
    descKey: "home.cardScheduleDesc",
    glyph: "dots",
    tone: "primary",
    requiredPermission: null,
  },
  {
    id: "tasks",
    titleKey: "home.cardTasksTitle",
    descKey: "home.cardTasksDesc",
    glyph: "bars",
    tone: "success",
    requiredPermission: null,
  },
];

/** The user's resolved capabilities — computed once, server-side. */
export interface DashboardCapabilities {
  owner: boolean;
  /** Belongs to at least one organization. */
  hasOrganization: boolean;
  /** Union of effective permission keys across the user's organizations. */
  permissions: ReadonlySet<string>;
}

/** Pure gate filter — registry semantics + the org-membership nav rule. */
export function filterDashboardCards(
  cards: DashboardCard[],
  caps: DashboardCapabilities
): DashboardCard[] {
  return cards.filter((card) => {
    if (card.ownerOnly) return caps.owner;
    if (card.requiresOrganization && !caps.hasOrganization) return false;
    if (card.requiredPermission) return caps.permissions.has(card.requiredPermission);
    return true;
  });
}
