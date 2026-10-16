"use client";

import { useActionState } from "react";
import { useI18n } from "@/i18n";
import { InfoIcon } from "@/components/icons";
import { signupAction, type SignupState } from "./actions";

const initialState: SignupState = { error: null };

/**
 * The signup form — a structural mirror of {@link LoginForm}, so every
 * design-system rule it documents applies here unchanged (type is the closed
 * `.type-*` set; pressables and focusable inputs carry `.interactive`; colour,
 * radius and spacing are tokens only). See LoginForm for the full reasoning.
 *
 * Model A: email + password are required; the display name is OPTIONAL (the
 * action falls back to the email's local part), and there is NO organization
 * field at all — the org is created invisibly, named after the user.
 *
 * The password field uses `autoComplete="new-password"` (not `current-password`)
 * so the browser offers to generate/store a fresh credential rather than
 * autofilling an existing one.
 */
export function SignupForm() {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState(signupAction, initialState);

  const fieldClass =
    "min-h-11 w-full rounded-md bg-card px-sm py-xs type-body text-ink outline-none placeholder:text-muted interactive";

  return (
    <form action={formAction} className="flex w-full flex-col gap-md">
      <label className="flex flex-col gap-2xs">
        <span className="type-label text-muted">{t("login.email")}</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          dir="ltr"
          className={`${fieldClass} text-start`}
        />
      </label>

      <label className="flex flex-col gap-2xs">
        <span className="type-label text-muted">{t("login.password")}</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="new-password"
          dir="ltr"
          className={`${fieldClass} text-start`}
        />
      </label>

      <label className="flex flex-col gap-2xs">
        <span className="type-label text-muted">{t("signup.displayName")}</span>
        <input name="displayName" type="text" autoComplete="name" className={fieldClass} />
      </label>

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
        disabled={pending}
        className="min-h-11 w-full rounded-md bg-accent px-md py-xs type-heading text-on-fill interactive touch-manipulation motion-safe:active:scale-[0.97]"
      >
        {pending ? t("signup.signingUp") : t("signup.submit")}
      </button>
    </form>
  );
}
