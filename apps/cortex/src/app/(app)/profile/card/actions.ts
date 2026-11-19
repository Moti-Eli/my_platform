"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@platform/db";
import type { MessageKey } from "@/i18n";
import {
  CARD_DESCRIPTION_MAX,
  CARD_IMAGES_BUCKET,
  CARD_NAME_MAX,
  CARD_PHONE_MAX,
  CARD_TITLE_MAX,
  cardImagePathFor,
  codePointLength,
} from "@/lib/business-card";

/**
 * Business-card writes (profile stage 2). Every action:
 *   - takes the user from requireSession(), never from the form;
 *   - finds the user's card ITSELF (the screen offers one card: the earliest),
 *     never trusting a card id from the client;
 *   - writes on the RLS-scoped client — the DB allows only the caller's own rows
 *     and only the listed columns (20261023000001).
 * Errors are `card.*` i18n keys; a raw server message is never returned.
 */

export interface CardActionState {
  error: MessageKey | null;
  /** Set on a successful save so the form can show "saved" once. */
  savedAt: number | null;
}

/** The caller's card id (earliest), or null when they have none. */
async function ownCardId(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const res = await supabase
    .from("business_cards")
    .select("id")
    .eq("owner_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (res.error) throw new Error(res.error.message);
  return (res.data as { id: string } | null)?.id ?? null;
}

/** Trimmed text, or null when empty. */
function optional(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value.length > 0 ? value : null;
}

/** Create the user's card, or update it when it exists. */
export async function saveCardAction(
  _prev: CardActionState,
  formData: FormData
): Promise<CardActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const title = optional(formData, "title");
  const phone = optional(formData, "phone");
  const description = optional(formData, "description");

  if (codePointLength(name) === 0 || codePointLength(name) > CARD_NAME_MAX) {
    return { error: "card.nameInvalid", savedAt: null };
  }
  if (
    (title && codePointLength(title) > CARD_TITLE_MAX) ||
    (phone && codePointLength(phone) > CARD_PHONE_MAX) ||
    (description && codePointLength(description) > CARD_DESCRIPTION_MAX)
  ) {
    return { error: "card.tooLong", savedAt: null };
  }

  const { userId } = await requireSession();
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "card.notConfigured", savedAt: null };

  try {
    const cardId = await ownCardId(supabase, userId);
    const res = cardId
      ? await supabase
          .from("business_cards")
          .update({ name, title, phone, description, updated_at: new Date().toISOString() })
          .eq("id", cardId)
          .select("id")
      : await supabase
          .from("business_cards")
          .insert({ owner_id: userId, name, title, phone, description })
          .select("id");
    if (res.error || !res.data || res.data.length === 0) {
      if (res.error) console.error("saveCardAction failed", res.error.message);
      return { error: "card.saveFailed", savedAt: null };
    }
  } catch (err) {
    console.error("saveCardAction failed", err);
    return { error: "card.saveFailed", savedAt: null };
  }
  return { error: null, savedAt: Date.now() };
}

export interface CardResult {
  error: MessageKey | null;
}

/**
 * Point the card at its freshly uploaded image. Takes NO input: the browser has
 * already uploaded to "<card id>/image" (the storage policy allows only a card
 * the user owns); the path is derived here from the user's own card.
 */
export async function setCardImageAction(): Promise<CardResult> {
  const { userId } = await requireSession();
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "card.notConfigured" };
  try {
    const cardId = await ownCardId(supabase, userId);
    if (!cardId) return { error: "card.imageFailed" };
    const res = await supabase
      .from("business_cards")
      .update({ image_path: cardImagePathFor(cardId), updated_at: new Date().toISOString() })
      .eq("id", cardId)
      .select("id");
    if (res.error || !res.data || res.data.length === 0) {
      if (res.error) console.error("setCardImageAction failed", res.error.message);
      return { error: "card.imageFailed" };
    }
  } catch (err) {
    console.error("setCardImageAction failed", err);
    return { error: "card.imageFailed" };
  }
  return { error: null };
}

/** Remove the card's image: clear the column first, then delete the file. */
export async function removeCardImageAction(): Promise<CardResult> {
  const { userId } = await requireSession();
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "card.notConfigured" };
  try {
    const cardId = await ownCardId(supabase, userId);
    if (!cardId) return { error: "card.imageRemoveFailed" };
    const res = await supabase
      .from("business_cards")
      .update({ image_path: null, updated_at: new Date().toISOString() })
      .eq("id", cardId)
      .select("id");
    if (res.error || !res.data || res.data.length === 0) {
      if (res.error) console.error("removeCardImageAction failed", res.error.message);
      return { error: "card.imageRemoveFailed" };
    }
    const del = await supabase.storage.from(CARD_IMAGES_BUCKET).remove([cardImagePathFor(cardId)]);
    if (del.error) console.error("removeCardImageAction (storage) failed", del.error.message);
  } catch (err) {
    console.error("removeCardImageAction failed", err);
    return { error: "card.imageRemoveFailed" };
  }
  return { error: null };
}

/**
 * Delete the user's card. The image file goes FIRST — the storage policy checks
 * that the folder's card is yours, so once the row is gone the file could no
 * longer be removed by its owner.
 */
export async function deleteCardAction(): Promise<CardResult> {
  const { userId } = await requireSession();
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "card.notConfigured" };
  try {
    const cardId = await ownCardId(supabase, userId);
    if (cardId) {
      const del = await supabase.storage.from(CARD_IMAGES_BUCKET).remove([cardImagePathFor(cardId)]);
      if (del.error) console.error("deleteCardAction (storage) failed", del.error.message);
      const res = await supabase.from("business_cards").delete().eq("id", cardId).select("id");
      if (res.error || !res.data || res.data.length === 0) {
        if (res.error) console.error("deleteCardAction failed", res.error.message);
        return { error: "card.deleteFailed" };
      }
    }
  } catch (err) {
    console.error("deleteCardAction failed", err);
    return { error: "card.deleteFailed" };
  }
  redirect("/profile/card");
}
