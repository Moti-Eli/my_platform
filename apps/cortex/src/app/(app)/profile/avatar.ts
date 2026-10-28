/**
 * Profile photo constants, shared by the server actions, the profile page and the
 * browser upload. Each user has ONE photo object, at a fixed path in their own
 * folder of the private `avatars` bucket (20261020000002); a new upload replaces
 * it in place.
 */
export const AVATARS_BUCKET = "avatars";

/** Mirrors the bucket's file_size_limit (2 MB). */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/** Mirrors the bucket's allowed_mime_types. */
export const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Longest side, in pixels, after the in-browser shrink. */
export const AVATAR_MAX_SIDE = 512;

/** How long a signed photo URL stays valid (seconds). */
export const AVATAR_URL_TTL = 60 * 60;

/** The user's one photo object: "<user id>/avatar". */
export function avatarPathFor(userId: string): string {
  return `${userId}/avatar`;
}
