/**
 * Home-card registry (mobile Home design shell).
 *
 * Same gate semantics as `@platform/core` FeatureDefinition (ownerOnly /
 * requiredPermission / null), but a local type: home cards are placeholders
 * with no route yet, and they carry a couple of presentation-only fields
 * (glyph, tone, badge) the shared registry has no business knowing about.
 * When a card gets a real destination it graduates to a FEATURES entry and the
 * screen behind it gets a real guard.
 *
 * IMPORTANT: this filtering is UI convenience, NOT a security boundary — there
 * are no screens behind the cards. Real enforcement is per-screen, when a card
 * gains a destination (FEATURES.md Phase 2).
 */
import type { PermissionKey } from "@platform/auth";
import type { Catalog } from "@/lib/i18n";

type HomeKey = keyof Catalog["home"];

export type CardTone = "primary" | "success" | "warning" | "owner";
export type CardGlyph = "dots" | "bars" | "rings" | "diamond";

export interface HomeCard {
  /** Stable slug, future feature id. */
  id: string;
  /** i18n keys in the `home` namespace. */
  titleKey: HomeKey;
  descKey: HomeKey;
  /** Optional access badge shown on gated cards ("Admins only" / "Owner only"). */
  badgeKey?: HomeKey;
  /** Geometric glyph + accent tone (presentation only). */
  glyph: CardGlyph;
  tone: CardTone;
  /** Gate — same semantics as FeatureDefinition. null => every member. */
  requiredPermission?: PermissionKey | null;
  ownerOnly?: boolean;
}

export const HOME_CARDS: HomeCard[] = [
  {
    id: "schedule",
    titleKey: "cardScheduleTitle",
    descKey: "cardScheduleDesc",
    glyph: "dots",
    tone: "primary",
    requiredPermission: null,
  },
  {
    id: "tasks",
    titleKey: "cardTasksTitle",
    descKey: "cardTasksDesc",
    glyph: "bars",
    tone: "success",
    requiredPermission: null,
  },
  {
    id: "adminZone",
    titleKey: "cardAdminTitle",
    descKey: "cardAdminDesc",
    badgeKey: "badgeAdmin",
    glyph: "rings",
    tone: "warning",
    requiredPermission: "members.manage",
  },
  {
    id: "ownerZone",
    titleKey: "cardOwnerTitle",
    descKey: "cardOwnerDesc",
    badgeKey: "badgeOwner",
    glyph: "diamond",
    tone: "owner",
    ownerOnly: true,
  },
];

/** The user's resolved capabilities — computed once on screen load. */
export interface HomeCapabilities {
  owner: boolean;
  /** Belongs to at least one organization (gates members/chat, as on the old dashboard). */
  hasOrganization: boolean;
  /** Union of effective permission keys across the user's organizations. */
  permissions: ReadonlySet<string>;
}

/** Pure gate filter — identical semantics to the shared feature registry. */
export function filterHomeCards(
  cards: HomeCard[],
  caps: HomeCapabilities
): HomeCard[] {
  return cards.filter((card) => {
    if (card.ownerOnly) return caps.owner;
    if (card.requiredPermission) return caps.permissions.has(card.requiredPermission);
    return true;
  });
}
