"use client";

import { useActionState, useState } from "react";
import { useI18n } from "@/i18n";
import { InfoIcon } from "@/components/icons";
import { setPasswordAction, type SetPasswordState } from "./actions";

const initialState: SetPasswordState = { error: null };

/**
 * The set-password form — styled exactly like {@link LoginForm} (same field
 * recipe, the same `.interactive` opt-in for a visible keyboard focus ring, the
 * same announced error block). Two password fields; the password is `dir="ltr"`
 * inside the RTL page because a password is not Hebrew text.
 *
 * VALIDATION IS TWO-LAYERED. The fields are controlled so the two client checks —
 * at least 6 characters, and the two entries matching — can gate the submit
 * button and show a live message without a server round-trip. The server action
 * re-checks both regardless (never trust the client); its `state.error` covers
 * the cases the client cannot see (no session, a GoTrue failure, no env).
 */
export function SetPasswordForm() {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState(setPasswordAction, initialState);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Live client validation. `tooShort`/`mismatch` only show once the user has
  // typed, so an untouched field is never pre-flagged; `invalid` gates the submit.
  const tooShort = password.length > 0 && password.length < 6;
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const invalid = password.length < 6 || password !== confirmPassword;

  const fieldClass =
    "min-h-11 w-full rounded-md bg-card px-sm py-xs type-body text-ink outline-none placeholder:text-muted interactive";

  return (
    <div className="flex flex-col gap-lg">
      <header className="flex flex-col gap-2xs text-center">
        <h1 className="type-title text-ink">{t("setPassword.title")}</h1>
        <p className="type-body text-muted">{t("setPassword.subtitle")}</p>
      </header>

      <form action={formAction} className="flex w-full flex-col gap-md">
        <label className="flex flex-col gap-2xs">
          <span className="type-label text-muted">{t("setPassword.password")}</span>
          <input
            name="password"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            dir="ltr"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${fieldClass} text-start`}
          />
        </label>

        <label className="flex flex-col gap-2xs">
          <span className="type-label text-muted">{t("setPassword.confirm")}</span>
          <input
            name="confirmPassword"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            dir="ltr"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={`${fieldClass} text-start`}
          />
        </label>

        {/* One error line, announced. Client checks take precedence (they are
            what the user can act on right now); the server key fills in the rest.
            Same `role="alert"` + icon recipe as the login form, so the meaning
            survives colour-blindness and a greyscale screen. */}
        {tooShort || mismatch || state.error ? (
          <p
            role="alert"
            className="flex items-start gap-xs rounded-md bg-danger/10 px-sm py-xs type-label text-danger"
          >
            <InfoIcon width={18} height={18} aria-hidden className="mt-2xs shrink-0" />
            <span>
              {tooShort
                ? t("setPassword.tooShort")
                : mismatch
                  ? t("setPassword.mismatch")
                  : state.error
                    ? t(state.error)
                    : ""}
            </span>
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending || invalid}
          className="min-h-11 w-full rounded-md bg-accent px-md py-xs type-heading text-on-fill interactive touch-manipulation motion-safe:active:scale-[0.97]"
        >
          {pending ? t("setPassword.saving") : t("setPassword.submit")}
        </button>
      </form>
    </div>
  );
}
