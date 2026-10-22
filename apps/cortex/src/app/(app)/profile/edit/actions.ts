"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MessageKey } from "@/i18n";

/** Mirrors users_display_name_len_chk (20260610000002). */
const DISPLAY_NAME_MAX = 200;

export interface UpdateNameState {
  /** A `profile.name*` i18n key, or null. NEVER a raw server message — same
   *  never-render-raw rule as createOrgAction. */
  error: MessageKey | null;
}

/**
 * Save the signed-in user's own display name, then return to /profile.
 *
 * SECURITY — the row is NEVER chosen by the caller: the id comes from
 * requireSession(), and the write runs on the RLS-scoped server client, never
 * the admin client. The database enforces the rest (20261020000001): only the
 * `display_name` column is writable, and only on the caller's own row.
 */
export async function updateDisplayNameAction(
  _prev: UpdateNameState,
  formData: FormData
): Promise<UpdateNameState> {
  const displayName = String(formData.get("displayName") ?? "").trim();
  // Count code points, as the DB's char_length does (not UTF-16 units).
  const length = [...displayName].length;
  if (length === 0 || length > DISPLAY_NAME_MAX) {
    return { error: "profile.nameInvalid" };
  }

  const { userId } = await requireSession();

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "profile.nameNotConfigured" };

  // `.select` so a write RLS filtered to zero rows reads as a failure, not a
  // silent success.
  const res = await supabase
    .from("users")
    .update({ display_name: displayName })
    .eq("id", userId)
    .select("id");
  if (res.error || !res.data || res.data.length === 0) {
    if (res.error) console.error("updateDisplayNameAction failed", res.error.message);
    return { error: "profile.nameSaveFailed" };
  }

  redirect("/profile");
}
