"use client";

/**
 * Edit profile — name only for now (the photo joins in stage 1b). The same
 * full-bleed Screen frame as the rest of the profile flow, with a plain input +
 * save button in the CreateOrganization style: the closed `.type-*` set,
 * `.interactive`, colour/radius/spacing tokens only, `useActionState` with a
 * translated error. `pending` disables the in-flight submit; the trimmed-empty
 * guard blocks a blank name. On success the action redirects to /profile.
 */
import { useActionState, useState } from "react";
import { Screen } from "@/components/profile/Screen";
import { InfoIcon } from "@/components/icons";
import { useI18n } from "@/i18n";
import { updateDisplayNameAction, type UpdateNameState } from "./actions";

const initialState: UpdateNameState = { error: null };

export function EditProfileView({ displayName }: { displayName: string }) {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState(updateDisplayNameAction, initialState);
  const [name, setName] = useState(displayName);

  const fieldClass =
    "min-h-11 w-full rounded-md bg-card px-sm py-xs type-body text-ink outline-none placeholder:text-muted interactive";
  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && trimmed !== displayName.trim() && !pending;

  return (
    <Screen center={<h1 className="truncate type-title text-ink">{t("profile.editProfile")}</h1>}>
      <form action={formAction} className="flex w-full flex-col gap-sm pt-lg">
        <label htmlFor="displayName" className="type-label text-muted">
          {t("profile.nameLabel")}
        </label>
        <input
          id="displayName"
          name="displayName"
          type="text"
          value={name}
          maxLength={200}
          autoComplete="name"
          onChange={(e) => setName(e.target.value)}
          placeholder={t("profile.namePlaceholder")}
          className={fieldClass}
        />

        {state.error ? (
          <p
            role="alert"
            className="flex items-start gap-xs rounded-md bg-danger/10 px-sm py-xs type-label text-danger"
          >
            <InfoIcon width={18} height={18} aria-hidden className="mt-2xs shrink-0" />
            <span>{t(state.error)}</span>
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!canSubmit}
          className="min-h-11 w-full rounded-md bg-accent px-md py-xs type-heading text-on-fill interactive touch-manipulation motion-safe:active:scale-[0.97]"
        >
          {pending ? t("profile.nameSaving") : t("profile.nameSave")}
        </button>
      </form>
    </Screen>
  );
}
