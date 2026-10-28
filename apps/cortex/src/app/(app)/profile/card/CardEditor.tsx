"use client";

/**
 * The business-card editor (profile stage 2). One card for now (the schema allows
 * many). The same full-bleed Screen frame and form style as the edit-profile
 * screen: the closed `.type-*` set, `.interactive`, colour/radius/spacing tokens.
 *
 * No card yet → a create form (name required, the rest optional). With a card:
 * the same form to edit it, the image (choose / remove — shrunk in the browser,
 * uploaded with the user's own session into the card's folder of the public
 * `card-images` bucket), the public link with copy / share, its QR, and delete.
 *
 * Every write is a server action that finds the user's card itself; this
 * component never sends a user id or a card id to the server. The card id it
 * holds is only the upload folder, which the storage policy re-checks.
 */
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Screen } from "@/components/profile/Screen";
import { InfoIcon, CopyIcon, ShareIcon } from "@/components/icons";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { shrinkImage } from "@/lib/shrink-image";
import {
  CARD_DESCRIPTION_MAX,
  CARD_IMAGES_BUCKET,
  CARD_IMAGE_MAX_BYTES,
  CARD_IMAGE_TYPES,
  CARD_NAME_MAX,
  CARD_PHONE_MAX,
  CARD_TITLE_MAX,
  cardImagePathFor,
  type BusinessCard,
} from "@/lib/business-card";
import { useI18n, type MessageKey } from "@/i18n";
import {
  saveCardAction,
  setCardImageAction,
  removeCardImageAction,
  deleteCardAction,
  type CardActionState,
} from "./actions";

/** Longest side, in pixels, after the in-browser shrink. */
const CARD_IMAGE_MAX_SIDE = 512;

/** `navigator.share` never changes at runtime, so there is nothing to subscribe to. */
const noopSubscribe = () => () => {};

const initialState: CardActionState = { error: null, savedAt: null };

const fieldClass =
  "min-h-11 w-full rounded-md bg-card px-sm py-xs type-body text-ink outline-none placeholder:text-muted interactive";
const primaryButton =
  "min-h-11 w-full rounded-md bg-accent px-md py-xs type-heading text-on-fill interactive touch-manipulation motion-safe:active:scale-[0.97]";
const secondaryButton =
  "flex min-h-11 w-full items-center justify-center gap-xs rounded-md bg-hairline px-md py-xs type-heading text-ink interactive touch-manipulation motion-safe:active:scale-[0.97]";

function ErrorLine({ error }: { error: MessageKey }) {
  const { t } = useI18n();
  return (
    <p
      role="alert"
      className="flex items-start gap-xs rounded-md bg-danger/10 px-sm py-xs type-label text-danger"
    >
      <InfoIcon width={18} height={18} aria-hidden className="mt-2xs shrink-0" />
      <span>{t(error)}</span>
    </p>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-sm pt-lg">
      <h2 className="type-label text-muted">{title}</h2>
      {children}
    </section>
  );
}

export function CardEditor({
  card,
  unavailable,
  publicUrl,
  imageUrl,
  qr,
}: {
  /** The user's card, or null when they have none yet. */
  card: BusinessCard | null;
  /** The card table could not be read (e.g. the migration is not applied yet). */
  unavailable: boolean;
  /** The card's absolute public link, when there is a card. */
  publicUrl: string | null;
  /** The image's public URL, when the card has one. */
  imageUrl: string | null;
  /** The server-rendered QR for `publicUrl`. */
  qr: ReactNode;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [state, formAction, saving] = useActionState(saveCardAction, initialState);
  const [name, setName] = useState(card?.name ?? "");
  const [actionError, setActionError] = useState<MessageKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  // After the first save creates the card, the server page must re-render to
  // hand down the new card (link, QR, image controls).
  const hasCard = card !== null;
  useEffect(() => {
    if (state.savedAt && !hasCard) router.refresh();
  }, [state.savedAt, hasCard, router]);

  // Known only in the browser: false on the server render, the real answer on
  // the client — without a hydration mismatch.
  const canShare = useSyncExternalStore(
    noopSubscribe,
    () => typeof navigator.share === "function",
    () => false
  );

  function uploadImage(file: File) {
    if (!card) return;
    const cardId = card.id;
    setActionError(null);
    startTransition(async () => {
      if (!(CARD_IMAGE_TYPES as readonly string[]).includes(file.type)) {
        setActionError("card.imageBadType");
        return;
      }
      const blob = await shrinkImage(file, CARD_IMAGE_MAX_SIDE);
      if (!blob) {
        setActionError("card.imageBadType");
        return;
      }
      if (blob.size > CARD_IMAGE_MAX_BYTES) {
        setActionError("card.imageTooLarge");
        return;
      }
      const up = await createSupabaseBrowserClient()
        .storage.from(CARD_IMAGES_BUCKET)
        .upload(cardImagePathFor(cardId), blob, {
          upsert: true,
          contentType: "image/jpeg",
          cacheControl: "60",
        });
      if (up.error) {
        console.error("card image upload failed", up.error.message);
        setActionError("card.imageFailed");
        return;
      }
      const res = await setCardImageAction();
      if (res.error) {
        setActionError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function removeImage() {
    setActionError(null);
    startTransition(async () => {
      const res = await removeCardImageAction();
      if (res.error) {
        setActionError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function deleteCard() {
    if (!window.confirm(t("card.deleteConfirm"))) return;
    setActionError(null);
    startTransition(async () => {
      const res = await deleteCardAction();
      // On success the action redirects; only a failure returns here.
      if (res?.error) setActionError(res.error);
    });
  }

  async function copyLink() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
    } catch {
      setActionError("card.copyFailed");
    }
  }

  async function shareLink() {
    if (!publicUrl || !card) return;
    try {
      await navigator.share({ title: card.name, url: publicUrl });
    } catch {
      // Dismissing the share sheet rejects too — nothing to report.
    }
  }

  const canSave = name.trim().length > 0 && !saving;

  return (
    <Screen center={<h1 className="truncate type-title text-ink">{t("card.title")}</h1>}>
      {unavailable ? (
        <div className="pt-lg">
          <ErrorLine error="card.unavailable" />
        </div>
      ) : (
        <>
          {!card ? <p className="pt-lg type-body text-muted">{t("card.intro")}</p> : null}

          {/* The card's details — create or edit. */}
          <form action={formAction} className="flex w-full flex-col gap-sm pt-lg">
            <label htmlFor="card-name" className="type-label text-muted">
              {t("card.name")}
            </label>
            <input
              id="card-name"
              name="name"
              type="text"
              required
              value={name}
              maxLength={CARD_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("card.namePlaceholder")}
              className={fieldClass}
            />

            <label htmlFor="card-title" className="type-label text-muted">
              {t("card.role")}
            </label>
            <input
              id="card-title"
              name="title"
              type="text"
              defaultValue={card?.title ?? ""}
              maxLength={CARD_TITLE_MAX}
              placeholder={t("card.rolePlaceholder")}
              className={fieldClass}
            />

            <label htmlFor="card-phone" className="type-label text-muted">
              {t("card.phone")}
            </label>
            {/* Phone numbers read LTR even under an RTL layout. */}
            <input
              id="card-phone"
              name="phone"
              type="tel"
              dir="ltr"
              autoComplete="tel"
              defaultValue={card?.phone ?? ""}
              maxLength={CARD_PHONE_MAX}
              className={`${fieldClass} text-start`}
            />

            <label htmlFor="card-description" className="type-label text-muted">
              {t("card.description")}
            </label>
            <textarea
              id="card-description"
              name="description"
              rows={3}
              defaultValue={card?.description ?? ""}
              maxLength={CARD_DESCRIPTION_MAX}
              placeholder={t("card.descriptionPlaceholder")}
              className={`${fieldClass} min-h-24 resize-y`}
            />

            {state.error ? <ErrorLine error={state.error} /> : null}
            {state.savedAt && !state.error && card ? (
              <p role="status" className="type-label text-success">
                {t("card.saved")}
              </p>
            ) : null}

            <button type="submit" disabled={!canSave} className={primaryButton}>
              {saving ? t("card.saving") : card ? t("card.save") : t("card.create")}
            </button>
          </form>

          {card ? (
            <>
              {actionError ? (
                <div className="pt-lg">
                  <ErrorLine error={actionError} />
                </div>
              ) : null}

              {/* The image. */}
              <Section title={t("card.image")}>
                <div className="flex items-center gap-sm">
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-accent/15 type-display text-accent">
                    {imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a storage URL; next/image would need the storage host configured and gains nothing at 80px
                      <img src={imageUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      ([...card.name][0] ?? "")
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-xs">
                    <button
                      type="button"
                      onClick={() => fileInput.current?.click()}
                      disabled={busy}
                      className={secondaryButton}
                    >
                      {busy ? t("card.working") : t("card.imageChoose")}
                    </button>
                    {imageUrl ? (
                      <button
                        type="button"
                        onClick={removeImage}
                        disabled={busy}
                        className="min-h-11 w-full rounded-md px-md py-xs type-heading text-danger interactive touch-manipulation"
                      >
                        {t("card.imageRemove")}
                      </button>
                    ) : null}
                  </div>
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  accept={CARD_IMAGE_TYPES.join(",")}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) uploadImage(file);
                  }}
                />
              </Section>

              {/* The public link + QR. */}
              {publicUrl ? (
                <Section title={t("card.share")}>
                  <p className="type-body text-muted">{t("card.shareHint")}</p>
                  <a
                    href={publicUrl}
                    target="_blank"
                    rel="noopener"
                    dir="ltr"
                    className="break-all rounded-md bg-card px-sm py-xs text-start type-label text-accent interactive"
                  >
                    {publicUrl}
                  </a>
                  <div className="flex gap-sm">
                    <button type="button" onClick={copyLink} className={secondaryButton}>
                      <CopyIcon width={18} height={18} />
                      {copied ? t("card.copied") : t("card.copy")}
                    </button>
                    {canShare ? (
                      <button type="button" onClick={shareLink} className={secondaryButton}>
                        <ShareIcon width={18} height={18} />
                        {t("card.shareButton")}
                      </button>
                    ) : null}
                  </div>
                  <div className="flex justify-center pt-xs">{qr}</div>
                </Section>
              ) : null}

              {/* Delete. */}
              <Section title={t("card.dangerZone")}>
                <button
                  type="button"
                  onClick={deleteCard}
                  disabled={busy}
                  className="min-h-11 w-full rounded-md bg-danger/10 px-md py-xs type-heading text-danger interactive touch-manipulation"
                >
                  {t("card.delete")}
                </button>
              </Section>
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}
