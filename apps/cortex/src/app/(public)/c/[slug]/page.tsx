/**
 * A business card's PUBLIC page — opened from its link or QR, with or without a
 * session. It deliberately does NOT call requireSession().
 *
 * The data comes through ONE door: `get_public_business_card(slug)`
 * (20261023000001), a security-definer function that returns a single card's
 * display fields by its random slug — never its id or owner. The table itself
 * grants anon nothing, so there is no way to list cards. The call runs on the
 * ordinary server client (anon when signed out), never the admin client.
 *
 * Unknown slug → the app's not-found screen, which says nothing about whether a
 * card ever existed. A failed lookup (e.g. the migration is not applied yet) → a
 * translated line, not a crash. The page asks search engines not to index it.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LANG_COOKIE } from "@/lib/cookies";
import { CARD_IMAGES_BUCKET, type PublicBusinessCard } from "@/lib/business-card";
import { Wordmark } from "@/components/shell/Wordmark";
import { PhoneIcon } from "@/components/icons";
import { defaultLocale, dictionaries, isLocale, translate } from "@/i18n";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

interface CardRow {
  name: string;
  title: string | null;
  phone: string | null;
  description: string | null;
  image_path: string | null;
}

/** A slug is 16 lowercase hex characters (the table's CHECK). */
const SLUG_SHAPE = /^[0-9a-f]{16}$/;

export default async function PublicCardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!SLUG_SHAPE.test(slug)) notFound();

  const localeCookie = (await cookies()).get(LANG_COOKIE)?.value;
  const messages = dictionaries[isLocale(localeCookie) ? localeCookie : defaultLocale];
  const t = (key: Parameters<typeof translate>[1]) => translate(messages, key);

  const supabase = await createSupabaseServerClient();
  let card: PublicBusinessCard | null = null;
  let failed = !supabase;
  let imageUrl: string | null = null;
  if (supabase) {
    const res = await supabase.rpc("get_public_business_card", { p_slug: slug });
    if (res.error) {
      console.error("PublicCardPage (get_public_business_card) failed", res.error.message);
      failed = true;
    } else {
      const row = ((res.data ?? []) as CardRow[])[0];
      if (!row) notFound();
      card = {
        name: row.name,
        title: row.title,
        phone: row.phone,
        description: row.description,
        imagePath: row.image_path,
      };
      if (card.imagePath) {
        imageUrl = supabase.storage.from(CARD_IMAGES_BUCKET).getPublicUrl(card.imagePath).data
          .publicUrl;
      }
    }
  }

  if (failed || !card) {
    return (
      <p role="alert" className="rounded-md bg-card px-sm py-xs text-center type-body text-muted">
        {t("card.publicUnavailable")}
      </p>
    );
  }

  const initial = [...card.name][0] ?? "";

  return (
    <>
      <article className="flex flex-col items-center gap-sm rounded-xl bg-card p-lg text-center shadow-lifted">
        <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-full bg-accent/15 type-display text-accent">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a public storage URL; next/image would need the storage host configured
            <img src={imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            initial
          )}
        </div>
        <h1 className="type-title text-ink">{card.name}</h1>
        {card.title ? <p className="type-heading text-muted">{card.title}</p> : null}
        {card.description ? (
          <p className="whitespace-pre-line type-body text-ink">{card.description}</p>
        ) : null}
        {card.phone ? (
          <a
            href={`tel:${card.phone.replace(/[^\d+]/g, "")}`}
            className="mt-xs flex min-h-11 w-full items-center justify-center gap-xs rounded-md bg-accent px-md py-xs type-heading text-on-fill interactive touch-manipulation motion-safe:active:scale-[0.97]"
          >
            <PhoneIcon width={18} height={18} />
            <span dir="ltr">{card.phone}</span>
          </a>
        ) : null}
      </article>

      {/* The invitation — to sign up, nothing more (no link to this card's owner). */}
      <div className="flex flex-col items-center gap-sm text-center">
        <Wordmark />
        <p className="type-body text-muted">{t("card.joinHint")}</p>
        <Link
          href="/login?mode=signup"
          className="flex min-h-11 w-full items-center justify-center rounded-md bg-hairline px-md py-xs type-heading text-ink interactive touch-manipulation motion-safe:active:scale-[0.97]"
        >
          {t("card.join")}
        </Link>
      </div>
    </>
  );
}
