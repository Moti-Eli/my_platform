/**
 * Business cards (profile stage 2) — the shared shape, limits and paths, used by
 * the owner's editor (/profile/card), its server actions and the public page
 * (/c/<slug>). The table is `public.business_cards` (20261023000001): personal,
 * not org-scoped; owner-only through RLS; the public page reads one card by slug
 * through `get_public_business_card`.
 */
export const CARD_IMAGES_BUCKET = "card-images";

/** Mirror the table's CHECK constraints (code points, like char_length). */
export const CARD_NAME_MAX = 100;
export const CARD_TITLE_MAX = 100;
export const CARD_PHONE_MAX = 30;
export const CARD_DESCRIPTION_MAX = 300;

/** Mirror the bucket's file_size_limit (2 MB) and allowed_mime_types. */
export const CARD_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const CARD_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** The owner's own view of a card. */
export interface BusinessCard {
  id: string;
  slug: string;
  name: string;
  title: string | null;
  phone: string | null;
  description: string | null;
  imagePath: string | null;
  updatedAt: string;
}

/** What the public page gets — display fields only, never the id or owner. */
export interface PublicBusinessCard {
  name: string;
  title: string | null;
  phone: string | null;
  description: string | null;
  imagePath: string | null;
}

/** The card's one image object: "<card id>/image" (the CARD id, not the user's). */
export function cardImagePathFor(cardId: string): string {
  return `${cardId}/image`;
}

/** The public page's path. */
export function cardPublicPath(slug: string): string {
  return `/c/${slug}`;
}

/** Length in code points, as the DB's char_length counts. */
export function codePointLength(value: string): number {
  return [...value].length;
}
