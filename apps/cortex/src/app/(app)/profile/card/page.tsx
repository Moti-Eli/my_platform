/**
 * Server wrapper for the business-card editor (profile stage 2). THE access
 * boundary for this route: requireSession() is called HERE, as the first
 * statement. Reached by its direct path for now — the profile screen gets its
 * entry point in a later, separate step.
 *
 * Reads the caller's own card (the earliest; the screen offers one) through the
 * RLS-scoped server client. When there is a card it also builds the public link,
 * its QR (server-rendered SVG) and the image's public URL. If the table is not
 * there yet (the deploy landed before 20261023000001 was applied) the screen says
 * so in a translated line instead of crashing.
 */
import { cookies } from "next/headers";
import { requireSession } from "@/lib/session";
import { LANG_COOKIE } from "@/lib/cookies";
import { defaultLocale, dictionaries, isLocale, translate } from "@/i18n";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/base-url";
import { CARD_IMAGES_BUCKET, cardPublicPath, type BusinessCard } from "@/lib/business-card";
import { QrCode } from "@/components/QrCode";
import { CardEditor } from "./CardEditor";

interface CardRow {
  id: string;
  slug: string;
  name: string;
  title: string | null;
  phone: string | null;
  description: string | null;
  image_path: string | null;
  updated_at: string;
}

export default async function CardPage() {
  const { userId } = await requireSession();
  const supabase = await createSupabaseServerClient();

  let card: BusinessCard | null = null;
  let unavailable = !supabase;
  if (supabase) {
    const res = await supabase
      .from("business_cards")
      .select("id, slug, name, title, phone, description, image_path, updated_at")
      .eq("owner_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (res.error) {
      console.error("CardPage (business_cards) failed", res.error.message);
      unavailable = true;
    } else if (res.data) {
      const row = res.data as CardRow;
      card = {
        id: row.id,
        slug: row.slug,
        name: row.name,
        title: row.title,
        phone: row.phone,
        description: row.description,
        imagePath: row.image_path,
        updatedAt: row.updated_at,
      };
    }
  }

  let publicUrl: string | null = null;
  let imageUrl: string | null = null;
  if (card) {
    publicUrl = `${await getBaseUrl()}${cardPublicPath(card.slug)}`;
    if (card.imagePath && supabase) {
      const { publicUrl: url } = supabase.storage
        .from(CARD_IMAGES_BUCKET)
        .getPublicUrl(card.imagePath).data;
      // The object path never changes on replace; the version busts caches.
      imageUrl = `${url}?v=${encodeURIComponent(card.updatedAt)}`;
    }
  }

  // The QR is a server component, so its label is translated here (as not-found.tsx does).
  const localeCookie = (await cookies()).get(LANG_COOKIE)?.value;
  const qrLabel = translate(
    dictionaries[isLocale(localeCookie) ? localeCookie : defaultLocale],
    "card.qrLabel"
  );

  return (
    <CardEditor
      card={card}
      unavailable={unavailable}
      publicUrl={publicUrl}
      imageUrl={imageUrl}
      qr={publicUrl ? <QrCode value={publicUrl} label={qrLabel} /> : null}
    />
  );
}
