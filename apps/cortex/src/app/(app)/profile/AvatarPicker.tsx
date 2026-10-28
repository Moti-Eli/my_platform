"use client";

/**
 * The large profile avatar, now a working photo control. Tap → a small sheet:
 * "choose photo" (gallery or camera — the phone offers both for a plain file
 * input) and, when there is a photo, "remove photo".
 *
 * UPLOAD — straight from the browser to the PRIVATE `avatars` bucket with the
 * user's own session (the storage policy only lets them write their own folder),
 * after shrinking the image to {@link AVATAR_MAX_SIDE}px and re-encoding it as
 * JPEG in a canvas. Then {@link setAvatarAction} records the path (derived on the
 * server, never sent from here) and the page refreshes to sign a fresh URL.
 *
 * No photo, or the signed URL fails to load → the initial, as before. Errors are
 * translated keys only, never a raw storage message.
 */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { InfoIcon } from "@/components/icons";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useI18n, type MessageKey } from "@/i18n";
import { setAvatarAction, removeAvatarAction } from "./avatar.actions";
import {
  AVATARS_BUCKET,
  AVATAR_MAX_BYTES,
  AVATAR_MAX_SIDE,
  AVATAR_TYPES,
  avatarPathFor,
} from "./avatar";

/** Shrink to fit AVATAR_MAX_SIDE and re-encode as JPEG. Null = could not decode. */
async function shrinkImage(file: File): Promise<Blob | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const scale = Math.min(1, AVATAR_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.85));
}

export function AvatarPicker({
  userId,
  avatarUrl,
  initial,
}: {
  userId: string;
  /** A short-lived signed URL for the user's photo, or null when there is none. */
  avatarUrl: string | null;
  /** The name's first letter — the fallback when there is no photo. */
  initial: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [broken, setBroken] = useState(false);
  const [busy, startTransition] = useTransition();

  const showPhoto = avatarUrl !== null && !broken;

  function choose() {
    setError(null);
    fileInput.current?.click();
  }

  function upload(file: File) {
    startTransition(async () => {
      if (!(AVATAR_TYPES as readonly string[]).includes(file.type)) {
        setError("profile.avatarBadType");
        return;
      }
      const blob = await shrinkImage(file);
      if (!blob) {
        setError("profile.avatarBadType");
        return;
      }
      if (blob.size > AVATAR_MAX_BYTES) {
        setError("profile.avatarTooLarge");
        return;
      }
      const supabase = createSupabaseBrowserClient();
      const up = await supabase.storage
        .from(AVATARS_BUCKET)
        .upload(avatarPathFor(userId), blob, {
          upsert: true,
          contentType: "image/jpeg",
          cacheControl: "60",
        });
      if (up.error) {
        console.error("avatar upload failed", up.error.message);
        setError("profile.avatarUploadFailed");
        return;
      }
      const res = await setAvatarAction();
      if (res.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setBroken(false);
      router.refresh();
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const res = await removeAvatarAction();
      if (res.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        aria-label={t("profile.changePhoto")}
        className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-full bg-accent/15 type-display text-accent interactive motion-safe:active:scale-[0.97]"
      >
        {showPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL; next/image would need the storage host configured and gains nothing at 112px
          <img
            src={avatarUrl}
            alt=""
            onError={() => setBroken(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          initial
        )}
      </button>

      <input
        ref={fileInput}
        type="file"
        accept={AVATAR_TYPES.join(",")}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) upload(file);
        }}
      />

      {open ? (
        <div
          className="ds-backdrop fixed inset-0 z-[70] flex items-end justify-center bg-scrim p-md"
          onClick={() => (busy ? undefined : setOpen(false))}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("profile.changePhoto")}
            onClick={(e) => e.stopPropagation()}
            className="ds-panel flex w-[min(100%,24rem)] flex-col gap-sm rounded-xl bg-card p-lg shadow-lifted"
          >
            <h2 className="type-heading text-ink">{t("profile.changePhoto")}</h2>

            {error ? (
              <p
                role="alert"
                className="flex items-start gap-xs rounded-md bg-danger/10 px-sm py-xs type-label text-danger"
              >
                <InfoIcon width={18} height={18} aria-hidden className="mt-2xs shrink-0" />
                <span>{t(error)}</span>
              </p>
            ) : null}

            <button
              type="button"
              onClick={choose}
              disabled={busy}
              className="min-h-11 w-full rounded-md bg-accent px-md py-xs type-heading text-on-fill interactive touch-manipulation motion-safe:active:scale-[0.97]"
            >
              {busy ? t("profile.avatarWorking") : t("profile.avatarChoose")}
            </button>
            {avatarUrl !== null ? (
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="min-h-11 w-full rounded-md bg-hairline px-md py-xs type-heading text-danger interactive touch-manipulation motion-safe:active:scale-[0.97]"
              >
                {t("profile.avatarRemove")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              className="min-h-11 w-full rounded-md px-md py-xs type-heading text-muted interactive touch-manipulation"
            >
              {t("profile.avatarCancel")}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
