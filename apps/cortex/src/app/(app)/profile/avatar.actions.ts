"use server";

import { requireSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MessageKey } from "@/i18n";
import { AVATARS_BUCKET, avatarPathFor } from "./avatar";

export interface AvatarActionResult {
  /** A `profile.avatar*` i18n key, or null on success. NEVER a raw server message. */
  error: MessageKey | null;
}

/**
 * Point the signed-in user's profile at their freshly uploaded photo.
 *
 * Takes NO input: the browser has already uploaded the file to the user's own
 * folder (the storage policy allows nothing else), and the path is derived here
 * from requireSession() — the caller never names a path or a user. The write runs
 * on the RLS-scoped client; the DB allows only `avatar_path` on the caller's own
 * row, and its CHECK pins the path to the row's own folder (20261020000002).
 */
export async function setAvatarAction(): Promise<AvatarActionResult> {
  const { userId } = await requireSession();
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "profile.avatarNotConfigured" };

  const res = await supabase
    .from("users")
    .update({ avatar_path: avatarPathFor(userId) })
    .eq("id", userId)
    .select("id");
  if (res.error || !res.data || res.data.length === 0) {
    if (res.error) console.error("setAvatarAction failed", res.error.message);
    return { error: "profile.avatarUploadFailed" };
  }
  return { error: null };
}

/**
 * Remove the signed-in user's photo: clear the column FIRST (the screen falls
 * back to the initial at once), then delete the file. A failed file delete leaves
 * an orphan nobody links to — harmless, and the next upload overwrites it.
 */
export async function removeAvatarAction(): Promise<AvatarActionResult> {
  const { userId } = await requireSession();
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "profile.avatarNotConfigured" };

  const res = await supabase
    .from("users")
    .update({ avatar_path: null })
    .eq("id", userId)
    .select("id");
  if (res.error || !res.data || res.data.length === 0) {
    if (res.error) console.error("removeAvatarAction failed", res.error.message);
    return { error: "profile.avatarRemoveFailed" };
  }

  const del = await supabase.storage.from(AVATARS_BUCKET).remove([avatarPathFor(userId)]);
  if (del.error) console.error("removeAvatarAction (storage) failed", del.error.message);
  return { error: null };
}
